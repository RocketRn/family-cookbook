DROP POLICY recipe_steps_write ON recipe_steps;
CREATE POLICY recipe_steps_write ON recipe_steps FOR ALL TO cookbook_app
  USING (recipe_owned(recipe_id)) WITH CHECK (recipe_owned(recipe_id));
DROP POLICY recipes_update ON recipes;
CREATE POLICY recipes_update ON recipes FOR UPDATE TO cookbook_app
  USING (author_id = app_user_id())
  WITH CHECK (author_id = app_user_id() AND (book_id IS NULL OR is_book_member(book_id)));
DROP POLICY recipes_insert ON recipes;
CREATE POLICY recipes_insert ON recipes FOR INSERT TO cookbook_app
  WITH CHECK (author_id = app_user_id() AND (book_id IS NULL OR is_book_member(book_id)));
DROP FUNCTION media_owned(uuid);
DROP POLICY recipe_steps_system ON recipe_steps;
REVOKE SELECT ON recipe_steps FROM cookbook_system;
DROP POLICY media_read ON media; -- references recipes.cover_media_id and recipe_steps.photo_media_id
DROP INDEX recipe_steps_photo_idx;
DROP INDEX recipes_cover_idx;
ALTER TABLE recipe_steps DROP COLUMN photo_media_id;
ALTER TABLE recipes DROP COLUMN cover_media_id;
DROP TABLE media;
