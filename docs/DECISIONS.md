# Decisions (ADR-style)

Short records of decisions taken while building. Newest sprint last. "PRD" means `docs/PRD.md`, the source of truth; anything that changes it is marked **PRD change** and was approved by the product owner.

## Sprint 1

### D-001 Tooling

pnpm 10 workspaces, Node 20 target (`engines >=20`; developed on Node 22), TypeScript strict (`noUncheckedIndexedAccess` on), ESLint 9 flat config + Prettier, Vitest 2, Fastify 5, zod, `pg` with hand-written typed SQL (no ORM; schema lives only in `db/migrations`). Web uses **Vite 5**, not 6, because Vitest 2 bundles Vite 5 and mixed versions break config typing; revisit when moving to Vitest 3.

### D-002 `POST /books` (PRD change, approved)

PRD 4.9 had no way to create a book. Added `POST /books {title}`: creator becomes `owner`; only for a user not yet in a book. **Idempotent** means: a replay by the keeper of the same title returns the same book with `200` (a first call returns `201`); any other call by a user already in a book returns `409 ALREADY_IN_BOOK`. PRD 4.9 and 3.3 were updated in the repo copy.

### D-003 One book per user, one keeper per book (PRD change, approved)

`book_members` has `UNIQUE (user_id)` (constraint `book_members_one_book_per_user`) and a partial unique index allowing one `owner` per book. **Stage 2 (multiple books) drops the first constraint** (`ALTER TABLE book_members DROP CONSTRAINT book_members_one_book_per_user`); nothing else depends on it. `POST /books/leave` by the keeper returns `409 KEEPER_CANNOT_LEAVE` because role transfer is post-MVP. The keeper also cannot be removed through `DELETE /books/current/members/:user_id` (same code).

### D-004 Minimal `recipes` table

Sprint 1 creates `recipes` with only what the access rules (PRD 3.3) need: `id, author_id, book_id, title, status, visibility, share_token, created_at, updated_at, deleted_at`, plus the check "`book` visibility needs a book". BE-04 (Sprint 2) adds the rest. Rules for later migrations, so existing rows never break:

- any new `NOT NULL` column ships with a `DEFAULT` (or is added nullable, backfilled, then constrained);
- `visibility = 'public'` (Stage 4) is `ALTER TYPE recipe_visibility ADD VALUE 'public'`;
- `origin_recipe_id` (Stage 2 "My version") is a nullable column;
- `books.owner_id` and `book_members` already allow several books per user once D-003 is relaxed.

No Stage 2-4 tables exist; a migration test asserts the table list is exactly `users, books, book_members, recipes`.

### D-005 Row Level Security design

- One login role (the one in `DATABASE_URL`, also the table owner, runs migrations) and a restricted role `cookbook_app` (`NOLOGIN NOBYPASSRLS`). Every user-scoped request runs `withUser()`: `BEGIN; SET LOCAL ROLE cookbook_app; set_config('app.user_id', ..., true); set_config('app.share_token', ..., true)`. Everything is transaction-scoped, so it is safe behind transaction-mode connection poolers (tested: no leakage to the next use of a connection).
- Policies implement the PRD 3.3 read matrix exactly (`recipes_select`), author-only writes, and membership-scoped reads of `books` / `book_members`. `is_book_member()` is `SECURITY DEFINER` to avoid recursion.
- `cookbook_app` has **no write access** to `books` / `book_members`. Membership changes (create, join, leave, remove, rotate) run in `withSystem()` transactions with the authorization checks in application code and are covered by endpoint tests. Reason: "join by invite code" needs to look up a book the user cannot yet see, which RLS cannot express safely.
- The keeper's "unpublish someone else's recipe" has no policy yet (the endpoint is BE-04). Because RLS cannot restrict columns, it will be a `SECURITY DEFINER` function or a system transaction that only touches `visibility`, so the keeper never gets general edit rights.
- The role is cluster-wide; rollbacks keep it. It is created `IF NOT EXISTS` and granted to the migrating user, so it works with a superuser (Docker, CI) and with a plain owner role.
- `users` has no RLS (public Telegram profile only). Hardening idea for the owner's decision: restrict it to "self + members of my book".

### D-006 Dev `initData` (answer to open question 6)

Chosen: **the mock provider signs a fresh `initData` at every app start** (WebCrypto, fake token `000000:DEV-ONLY-FAKE-TOKEN`). No fixed signed string is committed for runtime use, and the API never skips the freshness check. The API accepts the fake dev token as an additional signing key only when `NODE_ENV=development` **and** `ALLOW_DEV_INIT_DATA=true`; the config refuses to boot with the flag anywhere else (tested), so the path cannot exist in production. The mock code is behind `import.meta.env.DEV` and a dynamic import; the production bundle was checked to contain neither the mock nor the token. Committed fixed strings exist only as unit-test vectors that pass an explicit `now`.

### D-007 Auth behaviour

Validated on every request (no sessions). Client sees only `401 Invalid or expired initData`; the precise reason is logged (`req.log.warn`). Duplicate keys in `initData` (for example a second `hash`) are rejected as malformed. `auth_date` more than 60 s in the future is rejected. Each request upserts the user (refreshing username, name, photo, `last_seen_at`); `ui_lang` is set only at creation. A soft-deleted account gets `403`. This is one extra write per request, acceptable at family scale; revisit with a throttle on `last_seen_at` if it ever shows up in metrics.

### D-008 What leaving or removal does to recipes

PRD says the author's `book` recipes become `private`. Implemented as: `visibility 'book' -> 'private'` and `book_id -> NULL` for **all** of the author's recipes in that book (drafts and `link` ones too). `link` recipes keep their `share_token`, so people who already have the link still get access (matrix row "anyone with token"); they just no longer belong to the book. Covered by tests.

### D-009 Other API details

- Error body everywhere: `{ "error": { "code", "message", "details?", "request_id" } }`; `request_id` is the Fastify request id (honours `x-request-id`).
- `GET /books/current` returns `404 NOT_IN_BOOK` when the user has no book; the web treats that as a state, not an error. The invite code is returned only to the keeper.
- Leave / remove return `204`. Joining twice with the same code is `200` (idempotent); a different book is `409 ALREADY_IN_BOOK`.
- A book holds at most 50 members (PRD 7.1); the 51st join is `409 CONFLICT`.
- Invite codes: 12 chars of base64url (72 random bits), inside the `startapp` alphabet.
- `GET /me` returns the profile only (PRD 4.9); `PATCH /me` is not in Sprint 1, so the manual language choice is stored in `localStorage` (`ui_lang`, PRD 4.8) and is not yet synced to the server.

### D-010 Web architecture

- **Boot once**: Telegram init -> `GET /me` -> language -> follow `start_param`. A regression test and an e2e run caught two bugs here (boot re-ran on every route change; the mock was installed twice under StrictMode); both fixed with tests that fail without the fix.
- **Language precedence**: manual choice > server `ui_lang` > Telegram `language_code` > `en`.
- **Recipe data seam**: screens use `RecipeApi` (`list`, `get`, `setSaved`). `api/recipeApi.ts` exports the typed mock; Sprint 2 swaps that one export. Search matches title and ingredient names; filters are difficulty, max total time, tags.
- **Deep links**: `join_`, `rc_`, `r_` have screens (`r_` is a stub until FE-11); `draft_` and `cook_` are parsed but have no route yet.
- **Strings**: all through i18next (ESLint `react/jsx-no-literals` + `pnpm i18n:check` in CI, which verifies keys, ru/uk four plural forms, en/sv two, and matching `{{placeholders}}`). `uk.json` and `sv.json` carry `_meta.status = needs-native-review`.

### D-011 Test database

Tests read `DATABASE_URL` (default in `.env.test`, CI overrides). The suite resets the schema and refuses to run on a database whose name lacks `test`. CI uses a GitHub Actions Postgres 15 service container. **This environment had no Docker daemon**, so development used a local Postgres 16; docker-compose and the CI workflow were written but not executed here (see the sprint report).

### D-012 recipe-core output contract (recorded now, built in Sprint 2)

For FE-06 the engine will return structured quantities and leave strings to a locale-aware formatter, per the kickoff prompt section 5: `Fraction {num, den}` reduced; `Quantity { whole, fraction | null, rawFloat, unit | null, rounding: continuous | spoon_cup | whole_item | spice_item | none, hint?: take_fraction_of | whole_plus_fraction, scalable }`. No float-to-Unicode-fraction conversion inside the engine; no float `===`. The PRD 5.2/5.3 pseudocode wins where it differs, and the final shape will be recorded here in Sprint 2. Sprint 1 only ships an empty, buildable `recipe-core`.
