-- The personal "Saved" shelf (PRD 1.x, UC-10, 3.2 saved_recipes; D-051). A person saves any recipe
-- they may read; the shelf shows it only while they still may (the recipes policy decides).

CREATE TABLE saved_recipes (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recipe_id  uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recipe_id)
);
CREATE INDEX saved_recipes_user_idx ON saved_recipes (user_id, saved_at DESC);
CREATE INDEX saved_recipes_recipe_idx ON saved_recipes (recipe_id);

ALTER TABLE saved_recipes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, DELETE ON saved_recipes TO cookbook_app;
GRANT INSERT (user_id, recipe_id) ON saved_recipes TO cookbook_app;
CREATE POLICY saved_own ON saved_recipes FOR ALL TO cookbook_app
  USING (user_id = app_user_id())
  WITH CHECK (user_id = app_user_id() AND recipe_visible(recipe_id));
