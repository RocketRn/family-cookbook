-- Notification settings and the new-recipe message (PRD 3.2 notify_prefs, 4.4 new_recipe; D-049).
-- Owner's Sprint 5 answers: "someone cooked my recipe" is on by default and quiet mode turns it off;
-- "a new recipe in the book" is off by default. Personal timer messages are not affected.

ALTER TABLE users ALTER COLUMN notify_prefs
  SET DEFAULT '{"timers": true, "cooked": true, "new_recipe": false, "mute_social": false}'::jsonb;
-- Nobody could change the settings before this version: everyone still has the old default.
UPDATE users SET notify_prefs = notify_prefs || '{"new_recipe": false}'::jsonb;

-- PATCH /me: the caller's own settings, merged with what is there. The user role cannot read the
-- column, and a person can only ever change their own row.
CREATE FUNCTION update_notify_prefs(p_prefs jsonb) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  IF jsonb_typeof(p_prefs) <> 'object' OR EXISTS (
       SELECT 1 FROM jsonb_each(p_prefs) e
        WHERE e.key NOT IN ('timers', 'cooked', 'new_recipe', 'mute_social')
           OR jsonb_typeof(e.value) <> 'boolean') THEN
    RAISE EXCEPTION 'notify_prefs: an unknown setting, or not true/false' USING ERRCODE = '22023';
  END IF;
  UPDATE users SET notify_prefs = notify_prefs || p_prefs
   WHERE id = app_user_id() AND deleted_at IS NULL
  RETURNING notify_prefs INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION update_notify_prefs(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_notify_prefs(jsonb) TO cookbook_app;

-- PRD 4.4 new_recipe: when a recipe reaches the book (published, for the book or by link, in a
-- book), every other member who turned these messages on gets one, five minutes later: more than
-- three at once become one message (the worker), and a recipe taken back in the meantime (made
-- private, unpublished, deleted) drops its messages. Once per recipe and person, ever.
CREATE FUNCTION queue_new_recipe() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  in_book_now boolean := NEW.status = 'published' AND NEW.visibility IN ('book', 'link')
                         AND NEW.book_id IS NOT NULL AND NEW.deleted_at IS NULL;
  in_book_before boolean := TG_OP = 'UPDATE' AND OLD.status = 'published'
                            AND OLD.visibility IN ('book', 'link') AND OLD.book_id IS NOT NULL
                            AND OLD.deleted_at IS NULL AND OLD.book_id = NEW.book_id;
BEGIN
  IF in_book_now AND NOT in_book_before THEN
    INSERT INTO notification_outbox (type, recipient_user_id, payload, dedupe_key, run_at)
    SELECT 'new_recipe', m.user_id,
           jsonb_build_object('recipe_id', NEW.id, 'recipe_title', NEW.title,
                              'author_name', (SELECT first_name FROM users WHERE id = NEW.author_id)),
           'new:' || NEW.id || ':' || m.user_id,
           now() + interval '5 minutes'
      FROM book_members m JOIN users u ON u.id = m.user_id
     WHERE m.book_id = NEW.book_id AND m.user_id <> NEW.author_id AND u.deleted_at IS NULL
       AND coalesce(u.notify_prefs ->> 'new_recipe', 'false') = 'true'
       AND coalesce(u.notify_prefs ->> 'mute_social', 'false') <> 'true'
    ON CONFLICT (dedupe_key) DO NOTHING;
  ELSIF in_book_before AND NOT in_book_now THEN
    DELETE FROM notification_outbox
     WHERE type = 'new_recipe' AND status = 'pending' AND payload ->> 'recipe_id' = NEW.id::text;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION queue_new_recipe() FROM PUBLIC;
CREATE TRIGGER recipes_new_recipe
  AFTER INSERT OR UPDATE OF status, visibility, book_id, deleted_at ON recipes
  FOR EACH ROW EXECUTE FUNCTION queue_new_recipe();
