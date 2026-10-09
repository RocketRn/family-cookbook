DROP POLICY users_update_self ON users;
REVOKE UPDATE (ui_lang) ON users FROM cookbook_app;
DROP FUNCTION soft_delete_recipe(uuid);
DROP FUNCTION unpublish_recipe(uuid);
DROP FUNCTION ensure_custom_tag(text);
DROP POLICY tags_read ON tags; -- references recipe_tags
DROP TABLE recipe_tags;
DROP TABLE tags;
DROP TABLE step_timers;
DROP TABLE step_ingredients;
DROP TABLE recipe_steps;
DROP TABLE recipe_videos;
DROP TABLE recipe_ingredients;
DROP FUNCTION step_recipe(uuid);
DROP FUNCTION recipe_owned(uuid);
DROP FUNCTION recipe_visible(uuid);
DROP INDEX recipes_published_idx;
ALTER TABLE recipes DROP CONSTRAINT recipes_share_token_iff_link;
ALTER TABLE recipes
  DROP COLUMN difficulty, DROP COLUMN prep_min, DROP COLUMN cook_min, DROP COLUMN servings,
  DROP COLUMN language, DROP COLUMN author_notes, DROP COLUMN source_type, DROP COLUMN raw_text,
  DROP COLUMN source_ref, DROP COLUMN version, DROP COLUMN published_at;
DROP TABLE units;
DROP TYPE round_class;
DROP TYPE qty_kind;
DROP TYPE recipe_source;
DROP TYPE recipe_difficulty;
DROP TYPE unit_dimension;
