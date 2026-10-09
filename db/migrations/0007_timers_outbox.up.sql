-- BE-08 / BE-09 (Sprint 4): cooking sessions, server timers and the notification outbox
-- (PRD 3.2, 4.4, 4.6; docs/DECISIONS.md D-039, D-040).
--
-- Who may do what:
--   cookbook_app     a user's own sessions and timers only (row-level security on user_id). Timers
--                    are created with INSERT; cancelling and "+1 min" go through narrow functions,
--                    so a user can never move a timer into "fired" or back to "running".
--   cookbook_worker  the worker process: fires due timers, writes and sends the outbox. It reads
--                    only the user columns it needs (Telegram id, language, bot_started) and never
--                    reads recipes: a timer keeps a snapshot of its recipe title and step number.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cookbook_worker') THEN
    CREATE ROLE cookbook_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT cookbook_worker TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO cookbook_worker;

-- ---------------------------------------------------------------------------------------
-- Cooking sessions (analytics; the progress itself lives on the client, PRD 4.8)
-- ---------------------------------------------------------------------------------------
CREATE TYPE cook_session_state AS ENUM ('active', 'finished', 'abandoned');

CREATE TABLE cook_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipe_id       uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  recipe_version  int NOT NULL CHECK (recipe_version >= 1),
  scale_factor    numeric(10, 6) NOT NULL DEFAULT 1 CHECK (scale_factor > 0 AND scale_factor <= 20),
  state           cook_session_state NOT NULL DEFAULT 'active',
  max_step_index  int NOT NULL DEFAULT 0 CHECK (max_step_index BETWEEN 0 AND 59),
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  CHECK ((state = 'finished') = (finished_at IS NOT NULL))
);
CREATE INDEX cook_sessions_user_idx ON cook_sessions (user_id, started_at DESC);
CREATE INDEX cook_sessions_active_idx ON cook_sessions (updated_at) WHERE state = 'active';

-- ---------------------------------------------------------------------------------------
-- Timers (PRD 4.6)
-- ---------------------------------------------------------------------------------------
CREATE TYPE timer_status AS ENUM ('running', 'fired', 'cancelled', 'failed');

CREATE TABLE timers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_timer_id  uuid NOT NULL,
  recipe_id        uuid REFERENCES recipes (id) ON DELETE SET NULL,
  step_id          uuid REFERENCES recipe_steps (id) ON DELETE SET NULL,
  cook_session_id  uuid REFERENCES cook_sessions (id) ON DELETE SET NULL,
  label            text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  -- Snapshot for the message, taken when the timer starts (the worker never reads recipes).
  recipe_title     text CHECK (length(recipe_title) <= 200),
  step_number      int CHECK (step_number BETWEEN 1 AND 60),
  duration_sec     int NOT NULL CHECK (duration_sec BETWEEN 1 AND 86400),
  started_at       timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  status           timer_status NOT NULL DEFAULT 'running',
  fired_at         timestamptz,
  cancelled_at     timestamptz,
  attempts         int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_timer_id),
  CHECK (ends_at = started_at + make_interval(secs => duration_sec)),
  -- A timer that fired (or then failed to deliver) has the moment it fired; others do not.
  CHECK ((status IN ('fired', 'failed')) = (fired_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
-- The poller's only query (PRD 4.6).
CREATE INDEX timers_due_idx ON timers (ends_at) WHERE status = 'running';
CREATE INDEX timers_user_idx ON timers (user_id, created_at DESC);
CREATE INDEX timers_cleanup_idx ON timers (created_at) WHERE status <> 'running';

-- Fire exactly once, enforced by the database whatever the code does: the only transitions are
-- running -> fired | cancelled and fired -> failed; the moment a timer fired never changes.
CREATE FUNCTION timers_transition_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'running' AND NEW.status IN ('fired', 'cancelled'))
    OR (OLD.status = 'fired' AND NEW.status = 'failed')) THEN
    RAISE EXCEPTION 'timer % cannot go from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.fired_at IS NOT NULL AND NEW.fired_at IS DISTINCT FROM OLD.fired_at THEN
    RAISE EXCEPTION 'timer % already fired', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'running' AND (NEW.ends_at <> OLD.ends_at OR NEW.duration_sec <> OLD.duration_sec) THEN
    RAISE EXCEPTION 'timer % is no longer running', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER timers_transition BEFORE UPDATE ON timers
  FOR EACH ROW EXECUTE FUNCTION timers_transition_guard();

-- ---------------------------------------------------------------------------------------
-- Outbox (PRD 4.4): every message to a user is written here first, then sent by the worker.
-- ---------------------------------------------------------------------------------------
CREATE TYPE outbox_status AS ENUM ('pending', 'sending', 'sent', 'failed', 'blocked');

CREATE TABLE notification_outbox (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type               text NOT NULL CHECK (type IN ('timer_fired', 'recipe_cooked', 'new_recipe')),
  recipient_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  payload            jsonb NOT NULL,
  -- timer:<id>, cooked:<reaction_id>, new:<recipe_id>:<user_id>: one message per event, ever.
  dedupe_key         text NOT NULL UNIQUE,
  -- 0 goes first (timer_fired), PRD 4.4.
  priority           smallint NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 9),
  status             outbox_status NOT NULL DEFAULT 'pending',
  attempts           int NOT NULL DEFAULT 0,
  run_at             timestamptz NOT NULL DEFAULT now(),
  -- A worker that claimed the row owns it until then; after that, another worker takes it over.
  locked_until       timestamptz,
  sent_at            timestamptz,
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK ((status = 'sending') = (locked_until IS NOT NULL))
);
CREATE INDEX outbox_due_idx ON notification_outbox (priority, run_at)
  WHERE status IN ('pending', 'sending');
CREATE INDEX outbox_recipient_idx ON notification_outbox (recipient_user_id) WHERE status = 'pending';

-- Telegram's limits (about 30 messages a second per bot, about 1 a second per chat): the next
-- moment a send is allowed, per key ('global', 'chat:<telegram id>'). Shared by all workers.
CREATE TABLE outbox_gates (
  key      text PRIMARY KEY CHECK (key = 'global' OR key ~ '^chat:-?[0-9]{1,20}$'),
  next_at  timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------
ALTER TABLE cook_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_gates ENABLE ROW LEVEL SECURITY;

-- The user role: own rows only; the recipe must be one the user may read.
GRANT SELECT, INSERT (user_id, recipe_id, recipe_version, scale_factor) ON cook_sessions TO cookbook_app;
GRANT UPDATE (max_step_index, state, finished_at, updated_at) ON cook_sessions TO cookbook_app;
CREATE POLICY cook_sessions_own ON cook_sessions FOR ALL TO cookbook_app
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id() AND recipe_visible(recipe_id));

GRANT SELECT ON timers TO cookbook_app;
GRANT INSERT (user_id, client_timer_id, recipe_id, step_id, cook_session_id, label, recipe_title,
  step_number, duration_sec, started_at, ends_at) ON timers TO cookbook_app;
CREATE POLICY timers_own_read ON timers FOR SELECT TO cookbook_app USING (user_id = app_user_id());
CREATE POLICY timers_own_insert ON timers FOR INSERT TO cookbook_app
  WITH CHECK (user_id = app_user_id() AND (recipe_id IS NULL OR recipe_visible(recipe_id)));

-- Cancel (DELETE /timers/:id) and +N seconds: only the owner, only while running. NULL = not
-- the caller's timer (or no such timer); the row otherwise.
CREATE FUNCTION cancel_timer(p_id uuid) RETURNS SETOF timers
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE timers SET status = 'cancelled', cancelled_at = now()
   WHERE id = p_id AND user_id = app_user_id() AND status = 'running'
  RETURNING * $$;
CREATE FUNCTION extend_timer(p_id uuid, p_seconds int) RETURNS SETOF timers
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE timers SET duration_sec = duration_sec + p_seconds,
                    ends_at = ends_at + make_interval(secs => p_seconds)
   WHERE id = p_id AND user_id = app_user_id() AND status = 'running'
     AND p_seconds BETWEEN 1 AND 3600 AND duration_sec + p_seconds <= 86400
  RETURNING * $$;
REVOKE ALL ON FUNCTION cancel_timer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION extend_timer(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_timer(uuid) TO cookbook_app;
GRANT EXECUTE ON FUNCTION extend_timer(uuid, int) TO cookbook_app;

-- The worker role.
GRANT SELECT, DELETE ON timers TO cookbook_worker;
GRANT UPDATE (status, fired_at, attempts) ON timers TO cookbook_worker;
CREATE POLICY timers_worker ON timers FOR ALL TO cookbook_worker USING (true) WITH CHECK (true);

GRANT SELECT ON cook_sessions TO cookbook_worker;
GRANT UPDATE (state, updated_at) ON cook_sessions TO cookbook_worker;
CREATE POLICY cook_sessions_worker ON cook_sessions FOR ALL TO cookbook_worker USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON notification_outbox TO cookbook_worker;
CREATE POLICY outbox_worker ON notification_outbox FOR ALL TO cookbook_worker USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON outbox_gates TO cookbook_worker;
CREATE POLICY gates_worker ON outbox_gates FOR ALL TO cookbook_worker USING (true) WITH CHECK (true);

GRANT SELECT (id, tg_user_id, ui_lang, bot_started, notify_prefs, deleted_at) ON users TO cookbook_worker;
GRANT UPDATE (bot_started) ON users TO cookbook_worker;
CREATE POLICY users_worker ON users FOR ALL TO cookbook_worker USING (true) WITH CHECK (true);

-- PRD 4.5: the bot may write to a user once they allowed it. Sign-in records Telegram's signed
-- allows_write_to_pm; the app records a granted requestWriteAccess (PATCH /me).
GRANT INSERT (bot_started), UPDATE (bot_started) ON users TO cookbook_system;
GRANT UPDATE (bot_started) ON users TO cookbook_app;
