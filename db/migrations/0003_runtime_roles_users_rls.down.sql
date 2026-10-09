DROP FUNCTION recipe_author_name(uuid);

DROP POLICY recipes_select ON recipes;
CREATE POLICY recipes_select ON recipes FOR SELECT TO cookbook_app
  USING (
    deleted_at IS NULL
    AND (
      author_id = app_user_id()
      OR (status = 'published' AND visibility IN ('book', 'link')
          AND book_id IS NOT NULL AND is_book_member(book_id))
      OR (status = 'published' AND visibility = 'link'
          AND share_token IS NOT NULL AND share_token = app_share_token())
    )
  );
DROP FUNCTION can_read_recipe(uuid, uuid, recipe_status, recipe_visibility, text, timestamptz);

DROP POLICY users_select ON users;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
REVOKE SELECT (id, tg_username, first_name, photo_url) ON users FROM cookbook_app;
GRANT SELECT ON users TO cookbook_app;
DROP FUNCTION shares_book_with(uuid);

DROP POLICY users_system ON users;
DROP POLICY books_system ON books;
DROP POLICY book_members_system ON book_members;
DROP POLICY recipes_system ON recipes;
REVOKE ALL ON users, books, book_members, recipes FROM cookbook_system;
REVOKE USAGE ON SCHEMA public FROM cookbook_system;
-- The cluster-wide roles (cookbook_system and the API login role) are intentionally kept.
