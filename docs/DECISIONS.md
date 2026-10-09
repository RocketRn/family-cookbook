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

> Partly superseded in Review round 2: the API no longer logs in as the table owner and "system" transactions no longer bypass RLS. See D-013 and D-014.

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

> Updated in Review round 2: tests use two URLs (D-013), CI runs Postgres 15 and 16, and docker-compose was run for real (D-016).

Tests read `DATABASE_URL` (default in `.env.test`, CI overrides). The suite resets the schema and refuses to run on a database whose name lacks `test`. CI uses a GitHub Actions Postgres 15 service container. **This environment had no Docker daemon**, so development used a local Postgres 16; docker-compose and the CI workflow were written but not executed here (see the sprint report).

### D-012 recipe-core output contract (recorded now, built in Sprint 2)

For FE-06 the engine will return structured quantities and leave strings to a locale-aware formatter, per the kickoff prompt section 5: `Fraction {num, den}` reduced; `Quantity { whole, fraction | null, rawFloat, unit | null, rounding: continuous | spoon_cup | whole_item | spice_item | none, hint?: take_fraction_of | whole_plus_fraction, scalable }`. No float-to-Unicode-fraction conversion inside the engine; no float `===`. The PRD 5.2/5.3 pseudocode wins where it differs, and the final shape will be recorded here in Sprint 2. Sprint 1 only ships an empty, buildable `recipe-core`.

## Review round 2 (after Sprint 1)

### D-013 Database users and roles (supersedes the login part of D-005)

Problem found in review: the API connected as the table owner (a superuser in Docker and CI). Owners bypass RLS, so only `SET LOCAL ROLE cookbook_app` protected user reads, and every "system" transaction ran with owner power.

Now there are four roles:

| Role                                         | Login | What it is for                                           | What it can do                                                                                                                                                                                         |
| -------------------------------------------- | ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| owner (`cookbook`, `MIGRATION_DATABASE_URL`) | yes   | migrations, seed, reset                                  | everything; never used by the running API                                                                                                                                                              |
| API user (`cookbook_api`, `DATABASE_URL`)    | yes   | the API process                                          | **nothing on its own**: `NOINHERIT`, owns nothing, no superuser/BYPASSRLS; it acts only after `SET LOCAL ROLE`                                                                                         |
| `cookbook_app`                               | no    | every request made on behalf of a user                   | filtered by RLS (PRD 3.3)                                                                                                                                                                              |
| `cookbook_system`                            | no    | sign-in upsert and membership changes authorised in code | not row-filtered, but limited by column-level GRANTs (for example it can change `recipes.visibility/book_id` but never `title` or `author_id`, and cannot insert recipes or touch `schema_migrations`) |

`pnpm db:migrate` creates or updates the API user from the user and password in `DATABASE_URL` and grants it the two roles. The API checks its own user at startup and refuses to run if it is a superuser, has BYPASSRLS, owns tables, inherits privileges, or lacks the roles. Because the API user has no privileges of its own, a `RESET ROLE` (for example through SQL injection) leaves it with nothing (tested). `SET LOCAL ROLE` and `set_config(..., true)` are transaction-scoped, so this stays compatible with transaction-mode connection poolers. `FORCE ROW LEVEL SECURITY` is not used: no runtime role owns a table, and forcing it would also filter migrations and seeds run by the owner.

### D-014 RLS on `users`; one predicate for the recipe matrix; the author-name path (A2)

- `cookbook_app` sees a `users` row only for itself and for members of its own book, and only the columns `id, first_name, tg_username, photo_url` (no `tg_user_id`, `notify_prefs`, `bot_started`, `ui_lang`, timestamps).
- The cross-table checks (`is_book_member`, `shares_book_with`) are `SECURITY DEFINER`, so the `users` and `book_members` policies never evaluate each other; queries joining them in both directions are tested.
- `can_read_recipe(...)` is the single SQL predicate for the PRD 3.3 read matrix. The `recipes_select` policy and `recipe_author_name(recipe_id)` both use it, so they cannot drift apart.
- `recipe_author_name(recipe_id)` returns only the author's display name, and only for a recipe the caller may read. A guest holding a share token gets the name without seeing the author's `users` row. It returns nothing for an anonymised (soft-deleted) author. Sprint 2's `GET /r/:share_token` and the recipe card should use it.

### D-015 Concurrent membership changes

Every membership change first locks the user's own row (`SELECT ... FOR UPDATE`), and joining also locks the book row. Before this, a double-tapped "Create book" or two simultaneous joins returned HTTP 500, and two people could take the 50th seat at the same time. Both are now covered by tests.

### D-016 Local S3 store: SeaweedFS instead of MinIO (please confirm)

Running `docker compose up` for real showed that `minio/minio` can no longer be pulled from Docker Hub (`pull access denied`; Bitnami's MinIO image is also gone). Docker Compose now runs SeaweedFS 4.48 with its S3 API on port 8333, pinned by image digest. The keys are fake local-only values matching `docker/seaweedfs/s3.json`. Verified here: bucket create, upload and download with the dev keys, and a wrong key is rejected. The kickoff named MinIO only as an example ("such as MinIO"), and nothing used S3 yet (photos arrive with BE-05 in Sprint 2), so nothing else changes. Production will use a real S3 + CDN (PRD 4.1).

### D-017 Migration safety

The runner stores a SHA-256 checksum of each applied migration and refuses to run if an applied file was edited (add a new migration instead). It also refuses to apply anything if any migration lacks its `.down.sql`. The test suite checks the step-by-step rollback and re-apply of every migration.

### D-018 Configuration and input guards

- Production refuses a `BOT_TOKEN` that looks like a placeholder or is not shaped `<digits>:<30+ chars>` (A-18), so the `.env.example` value can never be used to forge `initData` in production. `DEV_BOT_TOKEN` may not equal `BOT_TOKEN`.
- `auth_date` must be at most 12 digits (a huge value used to produce an Invalid Date that passed the freshness check); `user.id` must be a safe integer.
- A soft-deleted account is never refreshed from Telegram on sign-in (that would undo anonymisation, PRD 7.1).
- `x-request-id` is echoed only when it is at most 128 plain characters.
- CI fails if the production web bundle contains the dev Telegram mock or the fake token (`pnpm check:bundle`).

### D-019 Sprint 1 open questions closed with PRD defaults

- **Link recipes of a departing author** (report Q2): kept as in D-008. Their share link keeps working (PRD 3.3, "anyone with share_token") but they leave the book.
- **Keeper without an exit** (Q3): no new endpoint. PRD 3.3 and 7.3 say role transfer is post-MVP, so the keeper stays.
- **`users` visibility** (Q1): done (D-014).
- Still the owner's call: bot and Mini App names (Q4), `PATCH /me` for language sync (Q5, proposed for Sprint 2), Node version (Q6; Node 20 reached end of life on 2026-04-30, see the Sprint 2 plan).

## Sprint 2

### D-020 Recalculation engine: final output shape (completes D-012)

`packages/recipe-core` returns numbers as data, never as text. `scaleAmount(ingredient, k)` gives either `{ scalable: false, qtyKind, rawLine }` ("to taste", "a pinch", unparsed lines are shown exactly as written) or `{ scalable: true, min: Quantity, max: Quantity | null, unitRaw }`. `Quantity` is `{ value, whole, fraction | null, rawFloat, unit, rounding, hint?, scalable }` as planned in D-012, plus `value` (the rounded number to show).

- Rounding is "a whole number of steps", and a step is an exact fraction (for example 1/4 teaspoon or 5 g). The result is built from integers, so there is no floating-point drift. Floats are never compared with `===`; tests use a tolerance.
- A positive amount never rounds to zero. At k = 1 every amount is shown exactly as the author wrote it.
- PRD 5.2 limits: a warning below 0.25 or above 4, and a refusal below 0.05 or above 20. k is stored with 6 decimals.
- `formatAmount(scaled, { recipeLang, uiLang })` is separate. Numbers and units follow the recipe's language (PRD 1.5 #5); hints ("whisk 1 egg, take ½") follow the interface language.
- Tests: golden tables were written first (red commit `6e3cbbb`). Property tests (fast-check, test-only devDependency) check the PRD 5.3 properties: identity at k = 1, monotonic and idempotent rounding, non-scalable lines never change, at most 5% relative error for continuous amounts, a whole item never below its smallest piece, and a positive amount never rounds to zero.

### D-021 Units: one list, the database follows it

`UNITS` in `packages/recipe-core/src/units.ts` is the only place units are defined: code, dimension, factor to the base unit, aliases and labels in 4 languages. The `units` table is written from it by `pnpm db:migrate` (and the test setup), on every run. A test fails if the table and the list ever differ. Nobody edits the table by hand.

### D-022 Recipe API contract

- One request carries the whole recipe content: `ingredients`, `steps` and `videos` are replaced together. A PATCH that sends `ingredients` must also send `steps` (a step can point at ingredients, so half a set could leave broken links).
- Inside one request, lines refer to each other by a client `ref` (a step lists `{ ref, portion_fraction }`; step text may contain `{ing:<ref>}`). The server stores real ids and rewrites the placeholders. Ids sent back from a previous read are kept, so links and future reactions survive an edit.
- `version` (PRD 3.2) goes up by 1 only when a **published** recipe's content changes (title, servings, ingredients, steps, tags, and similar). Drafts and visibility-only changes do not bump it.
- Publishing needs a title, servings, at least one ingredient and at least one step. Otherwise the API answers 409 `NOT_PUBLISHABLE` with the missing parts.
- Lists: `GET /recipes?scope=book|mine`, newest first, keyset pages (default 50, at most 100) with an opaque cursor. Search is client-side over loaded pages until BE-11 (owner decision 6).
- PRD 7.1 limits are enforced: 100 ingredients, 60 steps, 10 videos, 20 tags, 10 timers per step, 20 photos.

### D-023 Share link token

Created when visibility becomes `link`: 16 bytes from the OS random generator (128 bits), base64url. Cleared when visibility leaves `link`, and a database CHECK makes "token present ⇔ visibility = link" impossible to break. Sharing again later gives a **new** token, so an old link stays dead. Only the author sees the token in API answers. `GET /r/:token` works only for a published, not deleted recipe (PRD 3.3) and shows the author's name through `recipe_author_name` (D-014). Sending the link through Telegram stays in BE-12.

### D-024 Columns deliberately not created yet

`origin_recipe_id` and `version_recipe_id` (Stage 2: copies and versions) and `search_tsv` (BE-11) are not in the schema yet. Adding them later is a plain additive migration. Creating them now would mean columns that no code fills or tests.

### D-025 Database functions that change rows on the user's behalf

Three things cannot be expressed as an ordinary RLS policy, so each is a small `SECURITY DEFINER` function with a fixed `search_path` that only `cookbook_app` may call, and each checks the caller itself:

- `unpublish_recipe(id)`: the author, or the keeper of the recipe's book, sets it to private and revokes the link. The keeper cannot change anything else (PRD 3.3).
- `soft_delete_recipe(id)`: the author only. RLS would refuse the UPDATE, because the deleted row becomes invisible to its own author.
- `ensure_custom_tag(name)`: free-form tags are private, so a user cannot see whether one already exists.

`media_owned(id)` is an ordinary (not definer) check used inside the recipe and step policies: an author may attach only photos they uploaded themselves.

### D-026 Photo storage (confirms D-016; owner decision 1)

All file access goes through the S3 API (`@aws-sdk/client-s3`). Endpoint, region, bucket, keys and path-style come from env (`S3_*` in `.env.example`), so production can point at any S3-compatible service without code changes. Locally and in CI this is SeaweedFS 4.48, pinned by digest. CI runs a contract test against it: bucket, upload, download, signed link, and that a forged signature is refused. SeaweedFS runs with `-volume.max=100`: it reserves 7 storage volumes per bucket and allows only 8 by default, so a second bucket (for example the test bucket next to the photo bucket) used to get no space (found by the contract test).

- Photos are not public. The API returns links signed for the current hour window, so the same link is reused within the hour (good for caching) and stays valid for at least an hour. `S3_PUBLIC_ENDPOINT` is the address browsers use when it differs from the internal one.
- In production the API refuses to start with the local development keys.
- Upload (PRD 6.2 BE-05): the type is detected from the file's bytes, not its name. The API accepts JPEG, PNG, WebP and AVIF up to 10 MB, refuses images over 50 megapixels before decoding them (decompression bombs), applies the EXIF rotation, then removes all metadata (EXIF, GPS). It stores a 2048 px and a 512 px JPEG.
- Photos nobody uses are removed by the worker after 24 hours, hourly, as `cookbook_system`. Database rows go first, then files: a leftover file is harmless, a row without a file would show a broken photo.

### D-027 Rate limits (owner decision on finding #20)

`@fastify/rate-limit`, in-memory, per minute, all configurable in env:

| What                          | Limit | Key        | Why                                                   |
| ----------------------------- | ----- | ---------- | ----------------------------------------------------- |
| any API request               | 300   | IP address | stops floods before any signature or database work    |
| any signed-in request         | 60    | user       | PRD 7.1                                               |
| photo upload                  | 10    | user       | sharp is CPU-heavy                                    |
| failed sign-in (bad initData) | 20    | IP address | slows down guessing; successful sign-ins do not count |

Over a limit the API answers 429 `RATE_LIMITED` with `Retry-After`. `/health` is not limited. Found by the tests: the plugin's own `rateLimit()` hook marks a request as "already limited", so a second limiter on the same request silently does nothing. The limits therefore use the plugin's `createRateLimit()` counters, each with its own hook. In-memory counters are per API process. That is enough for one instance (the MVP); several instances would need the plugin's Redis store. `TRUST_PROXY=true` is needed behind a reverse proxy so the limits see client addresses, not the proxy's.

### D-028 HEIC photos (owner decision)

The prebuilt sharp 0.35.4 used here (libvips 8.18.6) can read HEIF only for AVIF. It cannot decode iPhone HEIC (HEVC), and CI prints this on every run. A HEIC upload is detected by its bytes and answered with 415 `HEIC_NOT_SUPPORTED`, which the app shows as a translated message asking for JPEG, PNG or WebP. No heavy HEIC dependency was added. What a real iPhone actually sends from Telegram's photo picker (often already JPEG) needs a device test (ASSUMPTIONS A-20).
