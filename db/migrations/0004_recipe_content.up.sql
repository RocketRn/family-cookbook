-- BE-04 (Sprint 2): recipe content per PRD 3.2. Child tables inherit read access from their recipe
-- (the recipes policy, PRD 3.3) and only the recipe's author may change them.
-- Not created here on purpose: media and photo columns (BE-05), search_tsv (BE-11), Stage-2 columns
-- origin_recipe_id / version_recipe_id (docs/DECISIONS.md D-004, D-024).

CREATE TYPE unit_dimension AS ENUM ('mass', 'volume', 'count', 'other');
CREATE TYPE recipe_difficulty AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE recipe_source AS ENUM ('manual', 'paste', 'bot_forward', 'ocr');
CREATE TYPE qty_kind AS ENUM ('exact', 'range', 'to_taste', 'pinch', 'unparsed');
CREATE TYPE round_class AS ENUM ('continuous', 'whole_item', 'spice_item');

-- Rows come from packages/recipe-core UNITS (the single source of truth), written by `pnpm db:migrate`.
CREATE TABLE units (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z]{1,16}$'),
  dimension  unit_dimension NOT NULL,
  to_base    numeric,
  aliases    jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- New recipe columns. Every NOT NULL column has a default, so existing rows stay valid.
ALTER TABLE recipes
  ADD COLUMN difficulty    recipe_difficulty,
  ADD COLUMN prep_min      int CHECK (prep_min BETWEEN 0 AND 10080),
  ADD COLUMN cook_min      int CHECK (cook_min BETWEEN 0 AND 10080),
  ADD COLUMN servings      numeric(6,2) NOT NULL DEFAULT 4 CHECK (servings > 0),
  ADD COLUMN language      char(2) CHECK (language ~ '^[a-z]{2}$'),
  ADD COLUMN author_notes  text CHECK (length(author_notes) <= 5000),
  ADD COLUMN source_type   recipe_source NOT NULL DEFAULT 'manual',
  ADD COLUMN raw_text      text CHECK (length(raw_text) <= 20000),
  ADD COLUMN source_ref    jsonb,
  ADD COLUMN version       int NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN published_at  timestamptz;
UPDATE recipes SET published_at = created_at WHERE status = 'published';
-- A share token exists exactly while the recipe is shared by link (PRD 3.3; D-023).
ALTER TABLE recipes ADD CONSTRAINT recipes_share_token_iff_link
  CHECK ((visibility = 'link') = (share_token IS NOT NULL));

CREATE TABLE recipe_ingredients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id         uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  position          int NOT NULL CHECK (position >= 0),
  group_label       text CHECK (length(group_label) <= 100),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  name_norm         text,
  qty_kind          qty_kind NOT NULL,
  amount_min        numeric(12,4) CHECK (amount_min >= 0),
  amount_max        numeric(12,4),
  unit_code         text REFERENCES units (code),
  unit_raw          text CHECK (length(unit_raw) <= 50),
  round_class       round_class NOT NULL DEFAULT 'continuous',
  min_piece         numeric(4,2) CHECK (min_piece > 0),
  optional          boolean NOT NULL DEFAULT false,
  note              text CHECK (length(note) <= 500),
  raw_line          text CHECK (length(raw_line) <= 500),
  parse_confidence  real CHECK (parse_confidence BETWEEN 0 AND 1),
  -- PRD 3.2: exact/range have an amount; to_taste/pinch (and unparsed) do not.
  CONSTRAINT recipe_ingredients_amount_by_kind
    CHECK ((qty_kind IN ('exact', 'range')) = (amount_min IS NOT NULL)),
  CONSTRAINT recipe_ingredients_bounds CHECK (
    (qty_kind = 'exact' AND amount_max = amount_min)
    OR (qty_kind = 'range' AND amount_max > amount_min)
    OR (qty_kind NOT IN ('exact', 'range') AND amount_max IS NULL)),
  CONSTRAINT recipe_ingredients_no_unit_for_taste CHECK (qty_kind NOT IN ('to_taste', 'pinch') OR unit_code IS NULL),
  CONSTRAINT recipe_ingredients_position UNIQUE (recipe_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT recipe_ingredients_id_recipe UNIQUE (id, recipe_id)
);

CREATE TABLE recipe_videos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  youtube_id  text NOT NULL CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title       text CHECK (length(title) <= 200),
  position    int NOT NULL CHECK (position >= 0),
  CONSTRAINT recipe_videos_position UNIQUE (recipe_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT recipe_videos_id_recipe UNIQUE (id, recipe_id)
);

CREATE TABLE recipe_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id        uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  position         int NOT NULL CHECK (position >= 0),
  title            text CHECK (length(title) <= 200),
  body             text NOT NULL DEFAULT '' CHECK (length(body) <= 5000),
  video_id         uuid,
  video_start_sec  int CHECK (video_start_sec >= 0),
  CONSTRAINT recipe_steps_position UNIQUE (recipe_id, position) DEFERRABLE INITIALLY DEFERRED,
  -- A step can only link a video of the same recipe.
  CONSTRAINT recipe_steps_video FOREIGN KEY (video_id, recipe_id)
    REFERENCES recipe_videos (id, recipe_id) ON DELETE SET NULL (video_id)
);

CREATE TABLE step_ingredients (
  step_id           uuid NOT NULL REFERENCES recipe_steps (id) ON DELETE CASCADE,
  ingredient_id     uuid NOT NULL REFERENCES recipe_ingredients (id) ON DELETE CASCADE,
  portion_fraction  numeric(5,4) NOT NULL DEFAULT 1 CHECK (portion_fraction > 0 AND portion_fraction <= 1),
  PRIMARY KEY (step_id, ingredient_id)
);

CREATE TABLE step_timers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id       uuid NOT NULL REFERENCES recipe_steps (id) ON DELETE CASCADE,
  position      int NOT NULL CHECK (position >= 0),
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  duration_sec  int NOT NULL CHECK (duration_sec BETWEEN 1 AND 86400),
  CONSTRAINT step_timers_position UNIQUE (step_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_:-]{1,64}$'),
  -- NULL for system tags (named through i18n); the author's own wording for free-form tags.
  custom_name  text CHECK (length(custom_name) BETWEEN 1 AND 50)
);
INSERT INTO tags (slug) VALUES
  ('soup'), ('main'), ('salad'), ('breakfast'), ('baking'), ('dessert'), ('vegan'), ('gluten_free'), ('lean');

CREATE TABLE recipe_tags (
  recipe_id  uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  tag_id     uuid NOT NULL REFERENCES tags (id),
  PRIMARY KEY (recipe_id, tag_id)
);

CREATE INDEX recipe_ingredients_recipe_idx ON recipe_ingredients (recipe_id);
CREATE INDEX recipe_steps_recipe_idx ON recipe_steps (recipe_id);
CREATE INDEX recipe_videos_recipe_idx ON recipe_videos (recipe_id);
CREATE INDEX step_ingredients_ingredient_idx ON step_ingredients (ingredient_id);
CREATE INDEX step_timers_step_idx ON step_timers (step_id);
CREATE INDEX recipe_tags_tag_idx ON recipe_tags (tag_id);
CREATE INDEX recipes_published_idx ON recipes (book_id, published_at DESC) WHERE deleted_at IS NULL AND status = 'published';

-- ---------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_tags ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON units, tags TO cookbook_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipe_ingredients, recipe_videos, recipe_steps,
  step_ingredients, step_timers TO cookbook_app;
GRANT SELECT, INSERT, DELETE ON recipe_tags TO cookbook_app;
GRANT SELECT ON units TO cookbook_system;

CREATE POLICY units_read ON units FOR SELECT TO cookbook_app, cookbook_system USING (true);

-- "Can I read / write this recipe?" Both run as the caller, so the recipes policy decides.
CREATE FUNCTION recipe_visible(p_recipe_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM recipes WHERE id = p_recipe_id) $$;
CREATE FUNCTION recipe_owned(p_recipe_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM recipes WHERE id = p_recipe_id AND author_id = app_user_id()) $$;
CREATE FUNCTION step_recipe(p_step_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SET search_path = public AS
  $$ SELECT recipe_id FROM recipe_steps WHERE id = p_step_id $$;
REVOKE ALL ON FUNCTION recipe_visible(uuid), recipe_owned(uuid), step_recipe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recipe_visible(uuid), recipe_owned(uuid), step_recipe(uuid) TO cookbook_app;

CREATE POLICY recipe_ingredients_read ON recipe_ingredients FOR SELECT TO cookbook_app USING (recipe_visible(recipe_id));
CREATE POLICY recipe_ingredients_write ON recipe_ingredients FOR ALL TO cookbook_app
  USING (recipe_owned(recipe_id)) WITH CHECK (recipe_owned(recipe_id));
CREATE POLICY recipe_videos_read ON recipe_videos FOR SELECT TO cookbook_app USING (recipe_visible(recipe_id));
CREATE POLICY recipe_videos_write ON recipe_videos FOR ALL TO cookbook_app
  USING (recipe_owned(recipe_id)) WITH CHECK (recipe_owned(recipe_id));
CREATE POLICY recipe_steps_read ON recipe_steps FOR SELECT TO cookbook_app USING (recipe_visible(recipe_id));
CREATE POLICY recipe_steps_write ON recipe_steps FOR ALL TO cookbook_app
  USING (recipe_owned(recipe_id)) WITH CHECK (recipe_owned(recipe_id));
-- A link must join a step and an ingredient of the same recipe.
CREATE POLICY step_ingredients_read ON step_ingredients FOR SELECT TO cookbook_app
  USING (recipe_visible(step_recipe(step_id)));
CREATE POLICY step_ingredients_write ON step_ingredients FOR ALL TO cookbook_app
  USING (recipe_owned(step_recipe(step_id)))
  WITH CHECK (
    recipe_owned(step_recipe(step_id))
    AND EXISTS (SELECT 1 FROM recipe_ingredients i WHERE i.id = ingredient_id AND i.recipe_id = step_recipe(step_id)));
CREATE POLICY step_timers_read ON step_timers FOR SELECT TO cookbook_app USING (recipe_visible(step_recipe(step_id)));
CREATE POLICY step_timers_write ON step_timers FOR ALL TO cookbook_app
  USING (recipe_owned(step_recipe(step_id))) WITH CHECK (recipe_owned(step_recipe(step_id)));
CREATE POLICY recipe_tags_read ON recipe_tags FOR SELECT TO cookbook_app USING (recipe_visible(recipe_id));
CREATE POLICY recipe_tags_write ON recipe_tags FOR ALL TO cookbook_app
  USING (recipe_owned(recipe_id)) WITH CHECK (recipe_owned(recipe_id));
-- System tags are public; a free-form tag is visible only through a recipe the caller may read.
CREATE POLICY tags_read ON tags FOR SELECT TO cookbook_app
  USING (custom_name IS NULL OR EXISTS (SELECT 1 FROM recipe_tags rt WHERE rt.tag_id = tags.id));

-- Free-form tags are created through this function (the caller cannot see other people's free tags).
CREATE FUNCTION ensure_custom_tag(p_name text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := btrim(p_name);
  v_slug text;
  v_id uuid;
BEGIN
  IF app_user_id() IS NULL OR v_name = '' OR length(v_name) > 50 THEN
    RAISE EXCEPTION 'invalid custom tag' USING ERRCODE = '22023';
  END IF;
  v_slug := 'c:' || left(encode(sha256(convert_to(lower(v_name), 'UTF8')), 'hex'), 24);
  INSERT INTO tags (slug, custom_name) VALUES (v_slug, v_name) ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_id FROM tags WHERE slug = v_slug;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION ensure_custom_tag(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_custom_tag(text) TO cookbook_app;

-- Keeper moderation (PRD 3.3, 4.9): the author or the keeper of the recipe's book may unpublish it
-- (visibility -> private, share link revoked). The keeper still cannot change anything else.
CREATE FUNCTION unpublish_recipe(p_recipe_id uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH done AS (
    UPDATE recipes r SET visibility = 'private', share_token = NULL, updated_at = now()
     WHERE r.id = p_recipe_id AND r.deleted_at IS NULL
       AND (r.author_id = app_user_id()
            OR (r.book_id IS NOT NULL AND r.visibility IN ('book', 'link') AND r.status = 'published'
                AND EXISTS (SELECT 1 FROM book_members m
                             WHERE m.book_id = r.book_id AND m.user_id = app_user_id() AND m.role = 'owner')))
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM done) $$;
REVOKE ALL ON FUNCTION unpublish_recipe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unpublish_recipe(uuid) TO cookbook_app;

-- Soft delete by the author (PRD 4.9). A function, because the deleted row must stop being visible,
-- and an UPDATE through RLS may not produce a row its author can no longer read.
CREATE FUNCTION soft_delete_recipe(p_recipe_id uuid) RETURNS boolean
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH done AS (
    UPDATE recipes SET deleted_at = now(), updated_at = now()
     WHERE id = p_recipe_id AND author_id = app_user_id() AND deleted_at IS NULL
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM done) $$;
REVOKE ALL ON FUNCTION soft_delete_recipe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION soft_delete_recipe(uuid) TO cookbook_app;

-- PATCH /me: a user may change only their own interface language through the user role.
GRANT UPDATE (ui_lang) ON users TO cookbook_app;
CREATE POLICY users_update_self ON users FOR UPDATE TO cookbook_app
  USING (id = app_user_id()) WITH CHECK (id = app_user_id());
