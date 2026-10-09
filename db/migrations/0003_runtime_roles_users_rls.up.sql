-- Review round 2 (docs/DECISIONS.md D-013, D-014).
-- 1. `cookbook_system`: restricted role for work without a user identity (sign-in upsert) and for
--    membership changes authorised in application code. Never the table owner, no BYPASSRLS; what it
--    may do is defined by explicit (mostly column-level) GRANTs below.
-- 2. RLS on `users`: the user-scoped role sees only itself and members of its own book, and only
--    display columns.
-- 3. One SQL predicate for the PRD 3.3 recipe read matrix, shared by the RLS policy and by the
--    narrow author-name path for share-token readers.
-- The API logs in as a separate NOINHERIT role that is a member of cookbook_app and cookbook_system
-- (created from DATABASE_URL by `pnpm db:migrate`, see apps/api/src/db/roles.ts).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cookbook_system') THEN
    CREATE ROLE cookbook_system NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT cookbook_system TO CURRENT_USER;

-- ---- cookbook_system privileges (the GRANTs are the limit; its policies do not filter rows) ----
GRANT USAGE ON SCHEMA public TO cookbook_system;
GRANT SELECT ON users, books, book_members, recipes TO cookbook_system;
GRANT INSERT (tg_user_id, tg_username, first_name, photo_url, ui_lang) ON users TO cookbook_system;
GRANT UPDATE (tg_username, first_name, photo_url, last_seen_at) ON users TO cookbook_system;
GRANT INSERT (title, owner_id, invite_code) ON books TO cookbook_system;
GRANT UPDATE (invite_code) ON books TO cookbook_system;
GRANT INSERT (book_id, user_id, role), DELETE ON book_members TO cookbook_system;
GRANT UPDATE (visibility, book_id, updated_at) ON recipes TO cookbook_system;

CREATE POLICY users_system ON users FOR ALL TO cookbook_system USING (true) WITH CHECK (true);
CREATE POLICY books_system ON books FOR ALL TO cookbook_system USING (true) WITH CHECK (true);
CREATE POLICY book_members_system ON book_members FOR ALL TO cookbook_system USING (true) WITH CHECK (true);
CREATE POLICY recipes_system ON recipes FOR ALL TO cookbook_system USING (true) WITH CHECK (true);

-- ---- users: self + members of my book, display columns only ----
-- SECURITY DEFINER: reads book_members without going through book_members' own policy, so the
-- users policy and the book_members policy can never recurse into each other.
CREATE FUNCTION shares_book_with(p_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (
       SELECT 1 FROM book_members mine
         JOIN book_members theirs ON theirs.book_id = mine.book_id
        WHERE mine.user_id = app_user_id() AND theirs.user_id = p_user_id) $$;
REVOKE ALL ON FUNCTION shares_book_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shares_book_with(uuid) TO cookbook_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
REVOKE SELECT ON users FROM cookbook_app;
GRANT SELECT (id, tg_username, first_name, photo_url) ON users TO cookbook_app;
CREATE POLICY users_select ON users FOR SELECT TO cookbook_app
  USING (id = app_user_id() OR shares_book_with(id));

-- ---- recipes: one predicate for the PRD 3.3 read matrix ----
CREATE FUNCTION can_read_recipe(
  p_author_id uuid, p_book_id uuid, p_status recipe_status, p_visibility recipe_visibility,
  p_share_token text, p_deleted_at timestamptz
) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public AS
  $$ SELECT coalesce(
       p_deleted_at IS NULL
       AND (
         p_author_id = app_user_id()
         OR (p_status = 'published' AND p_visibility IN ('book', 'link')
             AND p_book_id IS NOT NULL AND is_book_member(p_book_id))
         OR (p_status = 'published' AND p_visibility = 'link'
             AND p_share_token IS NOT NULL AND p_share_token = app_share_token())
       ), false) $$;
REVOKE ALL ON FUNCTION can_read_recipe(uuid, uuid, recipe_status, recipe_visibility, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_read_recipe(uuid, uuid, recipe_status, recipe_visibility, text, timestamptz) TO cookbook_app;

DROP POLICY recipes_select ON recipes;
CREATE POLICY recipes_select ON recipes FOR SELECT TO cookbook_app
  USING (can_read_recipe(author_id, book_id, status, visibility, share_token, deleted_at));

-- Narrow path: the author's display name of a recipe the caller may read (e.g. a guest holding the
-- share token, who cannot see the author's users row). Returns nothing else, and nothing at all
-- for a recipe the caller cannot read.
CREATE FUNCTION recipe_author_name(p_recipe_id uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT CASE WHEN u.deleted_at IS NULL THEN u.first_name END
       FROM recipes r JOIN users u ON u.id = r.author_id
      WHERE r.id = p_recipe_id
        AND can_read_recipe(r.author_id, r.book_id, r.status, r.visibility, r.share_token, r.deleted_at) $$;
REVOKE ALL ON FUNCTION recipe_author_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recipe_author_name(uuid) TO cookbook_app;
