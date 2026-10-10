-- BE-07 (Sprint 5): the bot's incoming updates (PRD 3.2 tg_updates, 4.4 "Incoming"; D-047).
--
-- Telegram delivers each update to POST /bot/webhook at least once, and again when it is not sure
-- the first delivery arrived. The API records the update_id in the same transaction as handling
-- it, so an update is handled exactly once; a failed transaction leaves no record, and Telegram's
-- next delivery is handled.
--
-- Who may do what:
--   cookbook_system  records updates; queues only the answer to /start (type bot_start). It already
--                    creates users and sets bot_started (migrations 0003, 0007).
--   cookbook_worker  sends that answer like any other message, and forgets old updates.
--   cookbook_app     nothing here.

CREATE TABLE tg_updates (
  update_id    bigint PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tg_updates ENABLE ROW LEVEL SECURITY;

GRANT INSERT (update_id) ON tg_updates TO cookbook_system;
CREATE POLICY tg_updates_system ON tg_updates FOR INSERT TO cookbook_system WITH CHECK (true);
GRANT SELECT, DELETE ON tg_updates TO cookbook_worker;
CREATE POLICY tg_updates_worker ON tg_updates FOR ALL TO cookbook_worker USING (true) WITH CHECK (true);

-- The answer to /start goes through the outbox like every message (PRD 4.4).
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_type_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_type_check
  CHECK (type IN ('timer_fired', 'recipe_cooked', 'new_recipe', 'bot_start'));

GRANT INSERT (type, recipient_user_id, payload, dedupe_key, priority) ON notification_outbox
  TO cookbook_system;
CREATE POLICY outbox_system_start ON notification_outbox FOR INSERT TO cookbook_system
  WITH CHECK (type = 'bot_start');
