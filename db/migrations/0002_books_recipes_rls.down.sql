DROP TABLE recipes;
DROP TABLE book_members;
DROP TABLE books;
DROP FUNCTION is_book_member(uuid);
DROP FUNCTION app_share_token();
DROP FUNCTION app_user_id();
DROP TYPE recipe_visibility;
DROP TYPE recipe_status;
DROP TYPE book_role;
-- The cluster-wide role cookbook_app is intentionally kept (other databases may use it).
