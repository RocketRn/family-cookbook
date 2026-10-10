DROP TRIGGER reactions_cooked ON reactions;
DROP FUNCTION queue_recipe_cooked();
DROP FUNCTION cooked_by_name(uuid);
DROP FUNCTION reaction_counts(uuid);
DELETE FROM notification_outbox WHERE type = 'recipe_cooked';

ALTER POLICY media_read ON media
  USING (
    owner_id = app_user_id()
    OR EXISTS (SELECT 1 FROM recipes r WHERE r.cover_media_id = media.id)
    OR EXISTS (SELECT 1 FROM recipe_steps s WHERE s.photo_media_id = media.id)
  );

REVOKE ALL ON reactions FROM cookbook_system;
REVOKE ALL ON reactions FROM cookbook_app;
DROP TABLE reactions;
DROP TYPE reaction_kind;
