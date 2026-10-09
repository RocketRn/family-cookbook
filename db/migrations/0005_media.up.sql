-- BE-05 (Sprint 2): uploaded photos (PRD 3.2 media). Files live in S3-compatible storage under
-- storage_key; this table is the index. A photo is readable by its owner and by anyone who can read
-- a recipe or step that uses it (the recipes / recipe_steps policies decide).
CREATE TABLE media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users (id),
  storage_key  text NOT NULL UNIQUE CHECK (storage_key ~ '^media/[0-9a-f-]{36}$'),
  mime         text NOT NULL CHECK (mime = 'image/jpeg'),
  width        int NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height       int NOT NULL CHECK (height BETWEEN 1 AND 4096),
  bytes        int NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_owner_idx ON media (owner_id);
CREATE INDEX media_created_idx ON media (created_at);

-- PRD 3.2: recipes.cover_media_id, recipe_steps.photo_media_id. RESTRICT: a used photo is never removed.
ALTER TABLE recipes ADD COLUMN cover_media_id uuid REFERENCES media (id) ON DELETE RESTRICT;
ALTER TABLE recipe_steps ADD COLUMN photo_media_id uuid REFERENCES media (id) ON DELETE RESTRICT;
CREATE INDEX recipes_cover_idx ON recipes (cover_media_id) WHERE cover_media_id IS NOT NULL;
CREATE INDEX recipe_steps_photo_idx ON recipe_steps (photo_media_id) WHERE photo_media_id IS NOT NULL;

ALTER TABLE media ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT (id, owner_id, storage_key, mime, width, height, bytes, sha256) ON media TO cookbook_app;
-- Orphan clean-up (worker) runs as cookbook_system.
GRANT SELECT, DELETE ON media TO cookbook_system;
GRANT SELECT ON recipe_steps TO cookbook_system;

CREATE POLICY media_read ON media FOR SELECT TO cookbook_app
  USING (
    owner_id = app_user_id()
    OR EXISTS (SELECT 1 FROM recipes r WHERE r.cover_media_id = media.id)
    OR EXISTS (SELECT 1 FROM recipe_steps s WHERE s.photo_media_id = media.id)
  );
CREATE POLICY media_insert ON media FOR INSERT TO cookbook_app WITH CHECK (owner_id = app_user_id());
CREATE POLICY media_system ON media FOR ALL TO cookbook_system USING (true) WITH CHECK (true);
CREATE POLICY recipe_steps_system ON recipe_steps FOR SELECT TO cookbook_system USING (true);

-- An author may only attach their own uploads (not someone else's photo, even a visible one).
CREATE FUNCTION media_owned(p_media_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public AS
  $$ SELECT p_media_id IS NULL OR EXISTS (SELECT 1 FROM media WHERE id = p_media_id AND owner_id = app_user_id()) $$;
REVOKE ALL ON FUNCTION media_owned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION media_owned(uuid) TO cookbook_app;

DROP POLICY recipes_insert ON recipes;
CREATE POLICY recipes_insert ON recipes FOR INSERT TO cookbook_app
  WITH CHECK (author_id = app_user_id() AND (book_id IS NULL OR is_book_member(book_id)) AND media_owned(cover_media_id));
DROP POLICY recipes_update ON recipes;
CREATE POLICY recipes_update ON recipes FOR UPDATE TO cookbook_app
  USING (author_id = app_user_id())
  WITH CHECK (author_id = app_user_id() AND (book_id IS NULL OR is_book_member(book_id)) AND media_owned(cover_media_id));
DROP POLICY recipe_steps_write ON recipe_steps;
CREATE POLICY recipe_steps_write ON recipe_steps FOR ALL TO cookbook_app
  USING (recipe_owned(recipe_id)) WITH CHECK (recipe_owned(recipe_id) AND media_owned(photo_media_id));
