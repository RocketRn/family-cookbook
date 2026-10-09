-- BE-03: books, book_members, minimal recipes, access rules (PRD 3.3) and Row Level Security.
-- `recipes` holds only what the access rules need; the rest arrives with BE-04 (docs/DECISIONS.md D-004).

-- Restricted role the API switches to (SET LOCAL ROLE) for every user-scoped transaction.
-- Created without LOGIN: nobody connects as it directly. Roles are cluster-wide, so it is
-- created if missing and never dropped by a rollback.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cookbook_app') THEN
    CREATE ROLE cookbook_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
GRANT cookbook_app TO CURRENT_USER;

CREATE TYPE book_role AS ENUM ('owner', 'member');
CREATE TYPE recipe_status AS ENUM ('draft', 'published', 'archived');
CREATE TYPE recipe_visibility AS ENUM ('private', 'book', 'link');

CREATE TABLE books (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  owner_id     uuid NOT NULL REFERENCES users (id),
  invite_code  text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE book_members (
  book_id    uuid NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id),
  role       book_role NOT NULL DEFAULT 'member',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, user_id),
  -- MVP: one user, one book. Stage 2 drops this constraint (docs/DECISIONS.md D-003).
  CONSTRAINT book_members_one_book_per_user UNIQUE (user_id)
);
-- Exactly one keeper per book.
CREATE UNIQUE INDEX book_members_one_owner ON book_members (book_id) WHERE role = 'owner';

CREATE TABLE recipes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id    uuid NOT NULL REFERENCES users (id),
  book_id      uuid REFERENCES books (id) ON DELETE SET NULL,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  status       recipe_status NOT NULL DEFAULT 'draft',
  visibility   recipe_visibility NOT NULL DEFAULT 'private',
  share_token  text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  CONSTRAINT recipes_book_visibility_needs_book CHECK (visibility <> 'book' OR book_id IS NOT NULL)
);
CREATE INDEX recipes_book_id_idx ON recipes (book_id) WHERE deleted_at IS NULL;
CREATE INDEX recipes_author_id_idx ON recipes (author_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------
-- RLS helpers. The identity is set per transaction by the API with set_config(..., true).
-- ---------------------------------------------------------------------------------------
CREATE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app_share_token() RETURNS text
  LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.share_token', true), '') $$;

-- SECURITY DEFINER so the check can read book_members without recursing into its own policy.
CREATE FUNCTION is_book_member(p_book_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT EXISTS (SELECT 1 FROM book_members WHERE book_id = p_book_id AND user_id = app_user_id()) $$;

REVOKE ALL ON FUNCTION is_book_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_user_id(), app_share_token(), is_book_member(uuid) TO cookbook_app;

ALTER TABLE books ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO cookbook_app;
GRANT SELECT ON users, books, book_members TO cookbook_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON recipes TO cookbook_app;

CREATE POLICY books_select ON books FOR SELECT TO cookbook_app
  USING (is_book_member(id));

CREATE POLICY book_members_select ON book_members FOR SELECT TO cookbook_app
  USING (is_book_member(book_id));

-- PRD 3.3 read matrix. Soft-deleted recipes are invisible to everyone.
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

-- Only the author writes; a book recipe must go into a book the author belongs to.
CREATE POLICY recipes_insert ON recipes FOR INSERT TO cookbook_app
  WITH CHECK (author_id = app_user_id() AND (book_id IS NULL OR is_book_member(book_id)));

CREATE POLICY recipes_update ON recipes FOR UPDATE TO cookbook_app
  USING (author_id = app_user_id())
  WITH CHECK (author_id = app_user_id() AND (book_id IS NULL OR is_book_member(book_id)));

CREATE POLICY recipes_delete ON recipes FOR DELETE TO cookbook_app
  USING (author_id = app_user_id());
