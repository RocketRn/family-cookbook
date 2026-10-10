-- BE-10 (Sprint 5): reactions on recipes and "I cooked it" (PRD 2.4 steps 12-14, 3.2 reactions,
-- 4.4 recipe_cooked; D-048).
--
-- Who may do what:
--   cookbook_app     reacts to a recipe they may read (also by its link) and removes only their own
--                    reactions. It reads its own reactions and every reaction on its own recipes:
--                    the photo and words of "I cooked it" are for the author. Counts for any
--                    readable recipe come from reaction_counts(), a cook's name from
--                    cooked_by_name(). The app never writes the message to the author: the trigger
--                    below does, in the same transaction as the mark.
--   cookbook_system  sees which photos reactions use (the clean-up of unused photos).

CREATE TYPE reaction_kind AS ENUM
  ('heart', 'yum', 'fire', 'idea', 'curious', 'cooked', 'cook_again', 'my_version');

CREATE TABLE reactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id          uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind               reaction_kind NOT NULL,
  -- "I cooked it": words for the author, a photo of the dish, the cooking session.
  note               text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
  photo_media_id     uuid REFERENCES media (id) ON DELETE RESTRICT,
  cook_session_id    uuid REFERENCES cook_sessions (id) ON DELETE SET NULL,
  -- Stage 2 ("My version"): the recipe's copy.
  version_recipe_id  uuid REFERENCES recipes (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind IN ('cooked', 'my_version')
         OR (note IS NULL AND photo_media_id IS NULL AND cook_session_id IS NULL))
);
-- PRD 3.2: one of each emotion and of "I'll cook it again" per person; "I cooked it" any number of
-- times (owner's Sprint 5 answer 1: "cooked N times").
CREATE UNIQUE INDEX reactions_once_idx ON reactions (recipe_id, user_id, kind)
  WHERE kind NOT IN ('cooked', 'my_version');
CREATE INDEX reactions_recipe_idx ON reactions (recipe_id, kind);
CREATE INDEX reactions_user_idx ON reactions (user_id);
CREATE INDEX reactions_photo_idx ON reactions (photo_media_id) WHERE photo_media_id IS NOT NULL;

ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, DELETE ON reactions TO cookbook_app;
GRANT INSERT (recipe_id, user_id, kind, note, photo_media_id, cook_session_id) ON reactions
  TO cookbook_app;
CREATE POLICY reactions_read ON reactions FOR SELECT TO cookbook_app
  USING (user_id = app_user_id() OR recipe_owned(recipe_id));
-- "My version" stays hidden until stage 2 (owner, Sprint 4). Only your own photo and session.
CREATE POLICY reactions_insert ON reactions FOR INSERT TO cookbook_app
  WITH CHECK (
    user_id = app_user_id()
    AND kind <> 'my_version'
    AND recipe_visible(recipe_id)
    AND media_owned(photo_media_id)
    AND (cook_session_id IS NULL OR EXISTS (
      SELECT 1 FROM cook_sessions c
       WHERE c.id = cook_session_id AND c.user_id = app_user_id() AND c.recipe_id = reactions.recipe_id))
  );
CREATE POLICY reactions_delete ON reactions FOR DELETE TO cookbook_app
  USING (user_id = app_user_id());

GRANT SELECT (photo_media_id) ON reactions TO cookbook_system;
CREATE POLICY reactions_system ON reactions FOR SELECT TO cookbook_system USING (true);

-- The author sees the photo of "I cooked it" on their recipe; the cook sees their own (the
-- reactions policy decides which reactions are visible).
ALTER POLICY media_read ON media
  USING (
    owner_id = app_user_id()
    OR EXISTS (SELECT 1 FROM recipes r WHERE r.cover_media_id = media.id)
    OR EXISTS (SELECT 1 FROM recipe_steps s WHERE s.photo_media_id = media.id)
    OR EXISTS (SELECT 1 FROM reactions x WHERE x.photo_media_id = media.id)
  );

-- Counts for any recipe the caller may read (also by link), nothing for any other.
CREATE FUNCTION reaction_counts(p_recipe_id uuid) RETURNS TABLE (kind reaction_kind, n bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT x.kind, count(*)
    FROM reactions x JOIN recipes r ON r.id = x.recipe_id
   WHERE x.recipe_id = p_recipe_id
     AND can_read_recipe(r.author_id, r.book_id, r.status, r.visibility, r.share_token, r.deleted_at)
   GROUP BY x.kind $$;

-- The cook's name, for the recipe's author (who may not otherwise see a guest's profile) and for
-- the cook. Nothing for anyone else, nothing for a deleted account.
CREATE FUNCTION cooked_by_name(p_reaction_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN u.deleted_at IS NULL THEN u.first_name END
    FROM reactions x JOIN recipes r ON r.id = x.recipe_id JOIN users u ON u.id = x.user_id
   WHERE x.id = p_reaction_id AND (r.author_id = app_user_id() OR x.user_id = app_user_id()) $$;

REVOKE ALL ON FUNCTION reaction_counts(uuid), cooked_by_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reaction_counts(uuid), cooked_by_name(uuid) TO cookbook_app;

-- PRD 4.4 recipe_cooked: "I cooked it" on someone else's recipe queues one message to its author,
-- unless the author turned these messages off (notify_prefs: cooked = false, or quiet mode). The
-- payload is a snapshot: the worker never reads recipes or other people's profiles.
CREATE FUNCTION queue_recipe_cooked() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
BEGIN
  SELECT r.id, r.title, r.author_id, a.notify_prefs, a.deleted_at,
         (SELECT first_name FROM users WHERE id = NEW.user_id) AS cook_name,
         (SELECT storage_key FROM media WHERE id = NEW.photo_media_id) AS photo_key
    INTO rec
    FROM recipes r JOIN users a ON a.id = r.author_id
   WHERE r.id = NEW.recipe_id;
  IF rec.author_id = NEW.user_id OR rec.deleted_at IS NOT NULL
     OR coalesce(rec.notify_prefs ->> 'mute_social', 'false') = 'true'
     OR coalesce(rec.notify_prefs ->> 'cooked', 'true') = 'false' THEN
    RETURN NEW;
  END IF;
  INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key)
  VALUES ('recipe_cooked', rec.author_id,
          jsonb_build_object('reaction_id', NEW.id, 'recipe_id', rec.id,
                             'recipe_title', rec.title, 'cook_name', rec.cook_name,
                             'note', NEW.note, 'photo_key', rec.photo_key),
          'cooked:' || NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION queue_recipe_cooked() FROM PUBLIC;
CREATE TRIGGER reactions_cooked AFTER INSERT ON reactions
  FOR EACH ROW WHEN (NEW.kind = 'cooked') EXECUTE FUNCTION queue_recipe_cooked();
