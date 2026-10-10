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
- Lists: `GET /recipes?scope=book|mine`, newest first, keyset pages (default 50, at most 100) with an opaque cursor. Search was client-side over loaded pages until BE-11 (owner decision 6); since Sprint 3 it runs on the server (D-034).
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

### D-029 `{ing:<id>}` in step text stands for an amount

PRD 2.3 says a step should reference an ingredient with `{ing:<id>}` so that "the client substitutes the recalculated value". The card therefore shows the ingredient's **amount** there, formatted by recipe-core (for example "добавьте {ing:…} муки" becomes "добавьте 1 стакан муки"); the ingredient's name is in a tooltip. When the step is linked to only part of the ingredient (`portion_fraction`), the placeholder shows that step's share. Recalculation (FE-07, Sprint 3) will pass its k through the same function. Step text is always rendered as text, never as HTML.

### D-030 Recipe card and lists in the web app (FE-03)

- Lists come from `GET /recipes` in pages of 50 with a "Load more" button. Search and filters ran over the loaded pages until Sprint 3 (owner decision 6); they now run on the server (D-034).
- The card shows ingredients as written (k = 1) through recipe-core: numbers and units in the recipe's language, hints in the interface language (D-020). Sections are shown as written. In a step, an ingredient from a multi-section recipe also names its section (PRD 5.1).
- YouTube: nothing is loaded from YouTube until the user taps play (a faster card, and no third-party request when opening a recipe). Then the privacy-enhanced player (`youtube-nocookie.com`) starts at the step's second, with "Open in YouTube" (Telegram `openLink`) as the fallback (A-22).
- Photos: `srcset` states the real widths of the 512 px and full versions, so phones download the size they need.
- Reactions are shown as disabled markup with a "later version" note. Saving them is BE-10/FE-10 (Sprint 5).
- Saved tab (owner decision 5): production shows a neutral empty shelf. The dev build shows two seed recipes marked "Development sample". `pnpm check:bundle` fails if the sample reaches a production build (checked by removing the guard: the check failed as expected).
- Language choice is applied at once, kept on the device, and saved to the profile with `PATCH /me`. If saving fails, the choice stays and the user is told.

### D-031 UX-03 designs live in the dev build

UX-01/02 were delivered as working screens in code, and so is UX-03. The recipe editor (`/dev/editor`) and the import review (`/dev/review`) are built from the design system with sample data. They open from Profile → "Design previews" in development builds only, nothing on them is saved, and `pnpm check:bundle` keeps them out of production. They follow PRD 2.2 (steps 6–9) and 5.1:

- Review: the original text is folded at the top. Lines with confidence < 0.7 are highlighted, with the PRD 5.1.3 reasons in plain words (amount after the name, no unit, a number in brackets moved to the note, not recognized). Suggested ingredient links are chips per step, a found timer can be added or skipped, and a found YouTube link is attached to its step. Sections are editable headings.
- Editor: photo slot, title, servings stepper ("needed for recalculation"), difficulty, times, recipe language (numbers and units follow it; the recipe is never translated). Each ingredient line opens a details sheet: how much (exact, from–to, to taste, a pinch), the unit picked from recipe-core's list in the recipe's language, optional, note. Each step has text, linked ingredients, a photo, timers, and a YouTube link with a start time. Then tags (system and your own), who can see it (only me / book / by link), and Save draft / Publish. A publish attempt with something missing says what is missing, which mirrors the API's `NOT_PUBLISHABLE`.

The UX-03 texts are already translated into all four languages, so FE-04 and FE-05 reuse them. Since Sprint 3 the editor design is the real editor (D-035); only the import review design remains in the dev build.

## Sprint 3

### D-032 CSP: Report-Only first, report-uri, policy from env

PRD 7.1 asks for a Content-Security-Policy. Owner decision: ship it as `Content-Security-Policy-Report-Only` for the production build, with the API, S3, Telegram and YouTube origins from the build environment, and switch to enforcing only after the first real Telegram test.

- The policy (`apps/web/csp.ts`) allows only this site, Telegram's script, the YouTube player, the S3 photo origin and the API. It has no `unsafe-eval`; `unsafe-inline` is for styles only. `frame-ancestors` allows Telegram Web (A-23).
- `pnpm build` emits `dist/_headers` and `dist/csp-report-only.txt`. `vite preview` serves the header.
- Reports go to `POST /csp-report` on the API: no sign-in, 16 KB per body, its own limit (`RATE_LIMIT_CSP_REPORTS_PER_IP`, 60/min). Each violation is logged as "csp violation".
- **`report-uri` only, no `report-to`.** When `report-to` is present Chromium ignores `report-uri`, and in our Chromium test `report-to` reports were never delivered (70 s), while `report-uri` reports arrived at once.
- Verified in Chromium against the real API:
  - a missing S3 origin produced 5 `img-src` reports, which were logged, and the photos still loaded;
  - the correct configuration produced zero violations.
- How the owner checks during the first Telegram test: [docs/CSP.md](CSP.md).

### D-033 Text parser and POST /recipes/import (BE-06)

PRD 5.1 describes the pipeline; this records how it is built and the choices the PRD leaves open.

- **Where.** `packages/recipe-core/src/parse/*`, pure TypeScript, no network and no AI (PRD 5.1). Rules and words for the four languages are in `dictionaries.ts`. The same module will run in the browser for the full review (FE-05, Sprint 4).
- **Linear time, always.** Every regular expression is anchored and has no nested or overlapping quantifiers. Trailing-character trimming and the "amount - amount" split in `numbers.ts` are loops, not regular expressions. The old `parseAmount` pattern took 459 ms on 20,000 spaces; the loop takes about 2 ms on the same kinds of input. The P4 rule ("name - amount") looks for the dash only in the last 40 characters of a line. Only the first 100 ingredient lines are parsed and at most 60 steps are kept. `test/parse-safety.test.ts` sends 32 hostile 20,000-character texts with a budget of 250 ms each; the slowest takes about 32 ms.
- **A hard time limit on the server as well.** `POST /recipes/import` parses in a pool of worker threads (`IMPORT_WORKERS`, 2). A parse that runs longer than `IMPORT_TIMEOUT_MS` (3 s) is stopped by terminating its thread, which is then replaced. The answer is `422 IMPORT_TIMEOUT` and no recipe is created. A parser crash returns `422 IMPORT_FAILED`. The API stays responsive because parsing never runs on the request thread.
- **Endpoint.** Body `{text, ui_lang}`, where text is ≤ 20,000 characters and not empty (PRD 7.1). The endpoint has its own per-user limit (`RATE_LIMIT_IMPORTS_PER_USER`, 10 per minute). It creates a **private draft** with `source_type = 'paste'` and stores the original text unchanged in `raw_text`. It answers 201 with the recipe (the same shape as `GET /recipes/:id`) and an `import` block: confidence and reasons for each line (`p4`, `no_unit`, `bracket`, `unparsed`), plus the parser's warnings (`no_headings`, `no_ingredients`, `no_steps`, `truncated`). The review screen highlights lines from this block.
- **What goes into the draft.**
  - Every value is cut to the API limits.
  - The title falls back to "Новый рецепт" in the user's language.
  - Servings fall back to 4 (PRD 2.2 step 8).
  - Timers found in a step are stored as that step's timers.
  - An ingredient mentioned in a step is linked to it. When several steps mention it, each step gets an equal share rounded down to 0.01, so the shares never add up to more than 1.
  - A YouTube link becomes the step's video at its `t=` time.
  - The "Советы / Tips" section becomes the author's notes.
- **Choices the PRD leaves open.**
  - The displayed text keeps its original characters (typographic dashes, quotes). Only the copy used for matching is normalised (fractions, decimal comma, dashes, ё→е).
  - A line such as "Время: 1 час" with no prep/cook word counts as cooking time. "Подготовка" counts as preparation time.
  - Without headings, a line counts as an ingredient when it is short and has an amount or a unit and no sentence ending. Otherwise its neighbours decide.
  - Steps are split by numbered or bulleted markers, then by blank lines, then one per line. A text with no recognisable steps becomes a single step, so no text is lost.
  - Linking uses word stems with a prefix of 3–5 letters (e.g. «луковица» / «луковицу»).

### D-034 Server-side search and filters (BE-11)

Replaces the client-side search over loaded pages (owner decision 6, D-030).

- **What is searched.** `recipes.search_tsv` (migration 0006) holds the title, the ingredient names and the tag names. System tags are searchable by their names in all four interface languages (so «десерт», "dessert" and "efterrätt" all find a dessert). A test keeps that list equal to the web locale files. Free-form tags are searchable by their own text.
- **Two forms of each word.**
  - Plain words (Postgres `simple`) match a prefix while the user is still typing: «голу» finds «Голубцы».
  - Stems in the recipe language (Russian, English or Swedish) match other word forms: «яблоки» finds «кислых яблок», "tomato" finds "tomatoes".
  - Postgres has no Ukrainian stemmer. Ukrainian recipes use the Russian one, which handles common endings («яблука» finds «яблуко»). This is approximate.
  - Letters are lower-cased and ё is treated as е.
- **The query.** The API splits the text into words of letters and digits (at most 8 words of 40 characters; the text itself is at most 100). A database function builds the query: each word is quoted as a single lexeme, so `& | ! :* ( )` and quotes are never read as operators. Every word must match, as a prefix, either as typed or as a Russian, English or Swedish stem. The query is computed once per request and uses a GIN index.
- **Keeping it current.** Triggers recompute the vector when the title or language changes, and once per statement when ingredients or tags change. They run as the table owner, so they see the whole recipe. They fire only on rows the caller is allowed to write.
- **Filters.** `GET /recipes` takes the parameters below. All of them combine with `scope` and the search text; row-level security still decides what is visible.
  - `tag`, repeatable; every listed tag must be present;
  - `difficulty`;
  - `max_min`: preparation + cooking time at most this. A recipe with no time at all never matches a time limit, the same as the old client filter.
- **Order.** Results stay newest first, not ranked by relevance, so keyset pages stay stable. Family books are small enough for this. Ranking can come later without an API change.
- **Web.** The book screen sends the text 300 ms after the user stops typing and keeps the previous results visible while the new ones load. With a search or filter active, it shows "Found: N" (or "Found: N so far" when more pages exist). The "search covers only loaded recipes" note is gone.

### D-035 Recipe editor (FE-04) and card actions

- **Where.** `/recipe/new` (the "＋" button on the book screen) and `/recipe/:id/edit` (the "Edit" button on the card, for the author only). It is built from the UX-03 design. The dev-only editor mock-up is removed.
- **One body for everything.** The editor keeps its own state and sends the whole recipe with `POST /recipes` or `PATCH /recipes/:id` (D-022). Saved lines keep their ids, so links, placeholders and later reactions survive an edit. Empty lines and empty steps are left out, not reported. A saved line keeps its rounding class (`round_class`, `min_piece`) while its name is unchanged. A new or renamed line leaves it to the API, which derives it from the name (the same rule as the text import).
- **Amounts.** One field, read by recipe-core: "2", "1,5", "½", "1 1/2", "2–3". A range becomes `range`, a single number `exact`. "To taste" and "A pinch" replace the amount and the unit. Lines the import could not read stay "as written" (not recalculated) until the author enters an amount. Units come from recipe-core's list, in the recipe's language. Any other unit can be written as text.
- **Ingredient names inside step text (owner decision 3).** "Insert into the text" adds `name ([Name])`, for example «сахар ([сахар])». The author changes the word freely («сахаром»). `[Name]` is saved as `{ing:<id>}` and the card shows the amount there, the step's share of it (D-029). Recalculation will scale it too. Under the text box a line shows how the step will read: «сахаром (1 стакан)».
  - When two ingredients have the same name, the label adds the section («соль · Для теста») or a number.
  - Brackets that do not name an ingredient stay ordinary text.
  - Removing an ingredient turns its placeholders back into the written amount.
- **Portions.** A step uses an ingredient whole by default, or what other steps left of it. It can be changed to ¾, ⅔, ½, ⅓ or ¼. Parts of one ingredient may not add up to more than all of it; the editor marks the steps, and the API checks again.
- **Timers.** "Add timer" proposes the first time the step text mentions that has no timer yet ("Взбивайте 5 минут" → 5 min), found by the import's duration rules (PRD 5.1.4). Otherwise the timer is named after the first sentence. While building this, a parser bug showed up: when a sentence ended right after a unit ("…40 минут."), two timers in one sentence each got the whole sentence as their name instead of their own clause. It is fixed, with a test.
- **Photos (owner decision for iPhones).**
  - The picker accepts only JPEG, PNG and WebP, so iOS should hand over JPEG instead of HEIC (A-24, needs a device test).
  - A photo over 2048 px, or over 3 MB, is redrawn on a canvas: at most 2048 px on the long side, JPEG quality 0.8, white behind transparency. Other photos are sent as they are.
  - A HEIC file that still arrives is refused before upload, with the same message as the API.
  - Checked in Chromium: 4032×3024 → 2048×1536, 301 KB.
- **Checks.** Before saving: a title, servings above 0, whole minutes, a readable amount on every line, a named section, timers of 1 s to 24 h, a YouTube link and a start time that can be read. Publishing also needs an ingredient and a step with text (PRD 2.2 step 10). The API's `NOT_PUBLISHABLE` (missing parts) and `VALIDATION_ERROR` (paths such as `ingredients[3].amount_min`) are shown at the same fields.
- **Unsaved changes.** While there are changes, Telegram's Back button asks before leaving (Telegram's own dialog, Bot API 6.2+), and Telegram asks before the Mini App is closed (`enableClosingConfirmation`). A browser asks on reload.
- **Save buttons.** A draft has "Save draft" and "Publish". A published recipe has "Save" and stays published (its version goes up, D-022). Without a book, "Everyone in your book" is not offered.
- **Card actions.**
  - The author sees "Edit" and "Delete recipe". Delete asks first, then the recipe disappears for everyone (soft delete).
  - The author, or the keeper of the book, sees "Unpublish" while the recipe is shared. It asks first; afterwards only the author sees the recipe.

### D-036 Paste a recipe: the thin version (owner decision 1)

- "＋" on the book screen offers "Write a recipe" (the editor) or "Paste recipe text".
- The paste screen takes up to 20,000 characters. It shows the count and refuses longer text before sending. The text is kept on the device under the PRD 4.8 key `import-draft` until the recipe is created, so closing the app loses nothing. A failed parse (for example `IMPORT_TIMEOUT`) says why and keeps the text.
- "Parse" calls `POST /recipes/import` (D-033). The editor then opens on the new draft as "Check the recipe":
  - a short notice says how many lines to check, gives the parser's warnings in plain words (no headings found, no ingredients, no steps, text cut), and holds the original text, folded;
  - lines below confidence 0.7 are highlighted with the PRD 5.1.3 reasons;
  - a line the author changes is theirs: the highlight goes and the stored confidence is cleared.
- The import creates a private draft. In the editor its visibility starts as "Everyone in your book" when the author is in a book, so "Publish" means publishing to the book (PRD 2.2 step 9). "Save draft" keeps it to the author either way.
- Still to come in the full review (FE-05, Sprint 4): the original next to the result, accept or reject for each suggested timer and link, and moving lines between sections by dragging.

### D-037 Recalculation panel (FE-07) and the whole-item hint wording

- **Hint wording (owner decision 2).** Eggs keep "или взбить 2 шт. и взять ⅔". Other whole items say "или взять 2 зубчика и использовать ⅔", because garlic cannot be whisked. The same wording is used in all four interface languages; see PRD 5.3, which was updated, and the formatter tests in each language.
  - recipe-core tells eggs apart by name (`isEgg`: яйцо, яйця, яєць, egg, ägg). The hint carries `whisk: true|false`, and the formatter picks the words. Older callers that send only `rawLine` still work.
  - While building this, "eggplant" / "äggplanta" turned out to be classified as eggs (whole items). They are now ordinary products, with a test.
- **The panel.** "Recalculate" on the card opens a sheet with two modes (PRD 5.2):
  - by servings, with a stepper;
  - from one product: the user picks an ingredient line with an amount, types what they have and picks its unit. A product listed in two sections is offered as two lines, named by section (PRD 2.3). Only units that convert exactly are offered: g/kg, ml/l, otherwise the ingredient's own unit. Cups to grams would need densities (stage 2).
- **Limits (PRD 5.2).** Below ¼ or above 4 times, a "big change" warning is shown. Below 1/20 or above 20 times, the change is refused and "Recalculate" stays disabled. "From one product" shows the resulting servings, e.g. "≈ 2.5".
- **What follows k.**
  - The ingredient list, rounded by recipe-core (PRD 5.3).
  - The step ingredient lists and the `{ing:…}` amounts in step text (the step's share × k).
  - The servings in the header ("Servings: ≈ 2.5").
  - Timers and numbers typed in the step text do not change (PRD 5.2). When k ≠ 1, each timer says "time may differ" (PRD 2.3), and a note above the steps explains both.
- **Remembered per recipe.** The choice is stored under `recalc:<recipe_id>` (PRD 4.8): the mode, the servings or the product with amount and unit, and k to 6 decimals. On reopening, k is computed again from the recipe as it is now, so an edited recipe or a removed product never gives stale numbers. A banner on the card says what was recalculated, from what, and offers "Back to the original", which clears it.
- **Known limit.** A unit written only as text ("кочан") is not declined after recalculation ("2 кочан"). Units from the list are declined.

### D-038 Cooking mode designs (UX-04) and the test plan (QA-01)

- **Designs.** `/dev/cook` (development builds only, Profile → Design previews) shows the PRD 2.4 screens with sample data. FE-08 builds them in Sprints 4–5.
  - Preparation: resume ("Continue from step N / Start over") and a checklist of ingredients.
  - Step: "Step N of M" with a progress bar, large text, the step's ingredients, the video and timer buttons.
  - Timers: running and finished timers as chips at the bottom, with "+1 min" and "Cancel".
  - Done: "I cooked it" with a photo and a comment, and "I'll cook it again". "My version" is shown disabled; it is stage 2.
  - Problems: no connection, the bot was never started, the recipe changed meanwhile, and the screen cannot be kept on.
- **Sizes (PRD 7.1).**
  - Step text is 22 px with line height 1.5. The main buttons are 56 px high; every tap target is at least 44 px.
  - The whole step is the swipe zone (left = next, right = previous), with vertical swipes off.
  - Back and Next buttons are always shown, because Telegram Desktop has no gestures.
- **Test plan.** [`docs/QA.md`](QA.md) covers the test levels and where each lives, how to run them, test data, the browser paths checked each sprint, the real-device checks tied to open assumptions, severities, and which test covers which PRD acceptance criterion. Browser paths are run by hand each sprint until Sprint 5 adds them to CI as Playwright tests.

## Sprint 4

### D-039 Bot messages: outbox, sender, local Telegram stand-in

- **Outbox (PRD 4.4).** Every message goes first into `notification_outbox`, with a unique `dedupe_key` (`timer:<id>` …) so one event can never queue two messages. The worker sends due rows; `timer_fired` has priority 0 and goes first.
- **Several workers, no loss.**
  - A worker claims rows with `FOR UPDATE SKIP LOCKED` and marks them "sending" with a 30-second lease. If the worker dies, the lease runs out and another worker sends the message.
  - Delivery is at least once. The only duplicate possible is a crash in the moment between Telegram's answer and our update.
  - Tested with two senders at once and with a worker that stopped half-way.
- **Telegram's limits**, shared by all workers through the database (`outbox_gates`):
  - one message per chat per second, and 25 a second for the whole bot (Telegram allows about 30);
  - a **429** pauses that chat and the whole bot for `retry_after` seconds and does not count as a failed attempt;
  - a **403** stops all messages to that person, sets `bot_started = false`, and marks the timers behind those messages "failed" (PRD 4.4). The app can then show "the bot cannot write to you";
  - a **400** (Telegram refuses the message) is not retried;
  - other errors are retried after 1 s, 5 s, 30 s and 5 min, and fail after 5 attempts.
- **Text from user content.** Recipe titles and timer labels are never put into a message as they are:
  - control characters and invisible direction overrides (a spoofing trick) are removed, and all whitespace becomes single spaces;
  - the text is cut on a grapheme boundary (an emoji family or a flag is never split): 100 characters for a label, 64 for a title;
  - it is escaped for Telegram's HTML parse mode (`& < > "`);
  - it is wrapped in Unicode isolates, so Hebrew or Arabic cannot reorder the sentence around it;
  - placeholders are filled in one pass, so a label like `{title}` stays text.
    Tested with HTML, Markdown, entities, emoji, right-to-left text, a direction override, control characters and very long titles.
- **The message (PRD 4.4, 4.7).** "⏰ {label} — готово!", then «{title}», шаг {n}, in the recipient's interface language. The button "Открыть шаг" opens `t.me/<bot>/<app>?startapp=cook_<recipe>_<step>`.
- **Local stand-in, never the real Telegram.** `apps/fakebot` imitates `sendMessage`:
  - it gives the same answers, including 429, 403 and 400 for HTML Telegram would refuse;
  - its page at <http://127.0.0.1:8081> shows what was "sent";
  - it binds to 127.0.0.1 and is never deployed.
    The Telegram client refuses `api.telegram.org` unless explicitly allowed (production only). It also refuses to send the token to any other host unless explicitly allowed (development only), so a test or the demo can never reach Telegram.
- **The worker's database role** `cookbook_worker` can touch only timers, the outbox, the gates, and the user columns needed to send (Telegram id, language, `bot_started`, preferences). A timer keeps a snapshot of its recipe title and step number, so the worker never reads recipes.

### D-040 Server timers and cooking sessions

- **Limits (PRD 4.6, owner's answer for Sprint 4).**
  - Up to 10 running timers per person, each from 1 second to 24 hours, with a label of 1–100 characters.
  - Starts by the same person run one at a time (a lock per person in the database), so ten taps at once cannot make an eleventh timer.
  - The database checks every limit again.
- **Exactly once, enforced by the database.**
  - A trigger allows only running → fired or cancelled, and fired → failed. Nothing goes back to running, and the moment a timer fired never changes.
  - The worker fires due timers in one statement (`FOR UPDATE SKIP LOCKED`), which also queues the message under the unique key `timer:<id>`.
  - Tested:
    - two workers at the same time with 40 timers;
    - a worker restart;
    - a timer that ended while the worker was down: it fires on the first tick after the restart, once, and the delay is logged;
    - a duplicate message inserted by hand: refused.
- **Retries and offline starts.**
  - The app sends its own `client_timer_id`; the same id again returns the same timer (200, not a second one).
  - A timer started offline sends its real `started_at`. A start in the future (a fast phone clock) counts from now, and a timer that is already over is refused (`TIMER_EXPIRED`).
- **The server clock.** Every answer carries `server_now`, so the app corrects its countdown when the phone's clock is wrong.
- **Ownership.**
  - Timers and cooking sessions are visible only to their owner (row-level security). The user role has no right to change a timer directly.
  - Cancel and "+1 min" go through two database functions that touch only the caller's own running timer.
  - Another person, even in the same book, gets 404, as for a timer that does not exist.
  - A timer can be started only for a recipe the person can read. Its title and step number are copied for the message.
  - Tested through the API and directly in the database.
- **Errors:**
  - `TOO_MANY_TIMERS` (409);
  - `TIMER_NOT_RUNNING` (409, already ended or cancelled);
  - `TIMER_TOO_LONG` (409, "+1 min" past 24 hours);
  - `TIMER_EXPIRED` (422).
- **`GET /timers?active=1`** returns running timers and those that ended in the last 15 minutes, so the app can show "done".
- **Cooking sessions** are for analytics and for linking timers to a cooking run. The progress itself (step, ticks, scale) stays on the device (PRD 4.8). The server records only the furthest step reached, and the end. A session left for 24 hours becomes "abandoned".
- **Clean-up.** Finished timers go after 7 days, and sent or failed messages after 30.
- **The bot may write (PRD 4.5).**
  - Sign-in records Telegram's signed `allows_write_to_pm`. Telegram leaves the field out rather than sending false, so sign-in only ever turns it on; a 403 from the bot turns it off.
  - `PATCH /me` stays as PRD 4.9 describes it: language and notification settings.
  - The worker tries to deliver whatever `bot_started` says. The app uses the flag only to warn "the notification will not arrive".
- **Where the worker sends.**
  - Production: only `https://api.telegram.org`, with a token of the real shape that is not a placeholder, the real bot username (the deep links use it) and no development storage keys. Otherwise the worker refuses to start.
  - Elsewhere: only a local stand-in (this computer or a one-word Docker host name).
  - With nothing configured, messages wait in the database.

### D-041 Cooking mode on the device

- **Progress lives on the phone** (PRD 4.8 `cook:<recipe_id>`). It holds the step, the ticked ingredients, the recalculation cooking started with, the timers, the server's session id, and a copy of the recipe.
  - It is written at once on every step and every tick (no 300 ms delay: a write is cheap and nothing is lost if the app is closed straight away).
  - It is dropped after 24 hours without activity, and when cooking is finished; the recalculation `recalc:<id>` is cleared then too (PRD 4.8).
  - A saved state that is damaged or belongs to another recipe is dropped, never half-used.
- **The recipe copy** lets cooking go on after a reload or without a connection. It also means a recipe the author edits during cooking is finished on the version it started with, and the Done screen says the recipe was changed (PRD 2.4). When the server sends the same version again, its copy replaces the saved one, so photo links stay fresh. A photo that no longer loads is hidden.
- **The recalculation** is the one chosen on the card when "Start cooking" is tapped. Changing it on the card later does not change a cooking run in progress.
- **Navigation.**
  - Swipes: left for the next step, right for the previous one, at least 60 px or a quarter of the width, and more sideways than vertical.
  - Back / Next buttons too, because Telegram Desktop has no gestures.
  - The last step is finished only with the button, never by a swipe.
  - A timer message opens `cook_<recipe>_<step>` straight at that step, without the "continue?" question.
- **Screen kept on** with the Screen Wake Lock API, asked for again when the app comes back to the front.
  - Where it is missing or refused, one notice per cooking screen asks to turn off auto-lock.
  - The PRD's second fallback, a hidden looping video, is not built: it needs a media file and has its own autoplay rules. Whether Telegram's in-app browsers on iPhone and Android allow Wake Lock must be checked on real phones (first Telegram test).
- **Server session** (`POST /cook-sessions`, then the furthest step after a 0.5 s pause, then `finished`) is best effort. Cooking never waits for it, and a failure is ignored.
- **Done screen.**
  - Buttons: "Back to the recipe" and "Cook it again".
  - "I cooked it" is shown as coming soon (saving it is the reactions work in Sprint 5).
  - "My version" is hidden (owner's answer for Sprint 4).

### D-042 Timers on screen

- **Started on the server, counted by the server's clock** (PRD 4.6). A tap on "⏱ Start timer: …" first stores the timer on the phone, then sends `POST /timers` with its own `client_timer_id`.
  - The countdown is `ends_at − (now + offset)`, where `offset` is taken from every `server_now`, so a phone clock that is wrong does not change it.
  - Tested with a phone clock an hour behind.
  - A timer that is already running cannot be started a second time from its button.
- **Chips on every step** show all of the person's active timers, from `GET /timers?active=1`. The list is fetched when cooking starts and again when the app comes back to the front.
  - The server's list is the truth for synced timers: one cancelled elsewhere disappears, and a "+1 min" made on another phone is taken over.
  - A list asked for before a start, "+1 min" or cancel, but answered after it, is cancelled: otherwise its out-of-date answer erased a timer just started. Found when a test failed under load at the end of the sprint; a test now holds the answer back on purpose.
  - Tapping a chip shows "+1 min" and "Cancel timer".
- **At zero** with the app open (PRD 4.6 #4): a vibration, and a large notice that stays at the top of the screen until closed. The bot's message is still sent.
  - Only a timer seen running on this screen rings.
  - The check waits for the server's list, so a timer that ended while the app was closed never rings late. That bug was found in the browser walkthrough and has a test.
- **No connection.** The timer runs on the phone, with the notice "No connection … no Telegram message will arrive".
  - It is sent again when the connection returns, when the app comes back, and every 15 seconds, with the same `client_timer_id` and the moment it really started, so the server counts it from then.
  - A timer that is already over by then is dropped (`TIMER_EXPIRED`).
  - A start whose first request is still waiting is never sent twice.
- **The bot may write (PRD 4.5).**
  - If Telegram's signed data or the server says the bot may not write yet, the first timer opens an explanation with "Allow messages", which calls Telegram's `requestWriteAccess`, and "Not now".
  - The timer starts either way. The answer is kept for this app session.
  - If the bot still may not write, the timers panel says no message will arrive and offers "Open the bot".
- **Not done yet** (FE-09 "full", Sprint 5):
  - timers on the recipe card outside cooking mode;
  - the "failed to deliver" state from a 403, shown on the chip;
  - sound.

### D-043 Full import review (FE-05)

- **Same editor, review mode.** After "Parse" the editor opens as "Check the recipe", as in Sprint 3 (D-036), now with the parts of the full review.
- **Suggestions.** Every timer and every ingredient link the parser found starts as a suggestion.
  - A timer shows "Timer found: 40 min · <label>" with "Keep this timer" or "Skip".
  - The links of a step are listed under "Suggested ingredients", each with "Keep" or "Remove".
  - The notice counts the suggestions still waiting.
  - Saving with some still waiting keeps them (they came from the text), so nothing found is lost by accident.
- **The original next to the result.**
  - From 720 px wide (Telegram Desktop, a tablet), the original text stays on the left while the form scrolls on the right.
  - On a phone it is a folded panel above the form.
  - The ingredient line being edited is marked in the original, using the line it was read from.
- **Moving lines between sections.** An ingredient's details have a "Section" choice listing the recipe's sections; the line moves to the end of the one chosen. Up / Down still work, and at a section edge they move the line into the next section.
  - Dragging was in the earlier plan. It is not built: a choice works the same with a finger, a mouse and a keyboard (Telegram Desktop), and drag and drop inside Telegram's in-app browsers would need checking on real phones.
- **Kept on the device** (PRD 4.8 `import-draft`).
  - Before "Parse" it holds the pasted text, as in Sprint 3.
  - After it, it holds the review in progress: the draft recipe it made, the original text, the parser's notes, and every edit and decision, written on each change.
  - Reopening the draft's editor, or the paste screen ("Continue checking «…»"), continues where the author was.
  - The review is cleared once the recipe is saved. A saved review whose recipe has since changed on the server is not used.
  - New lines added after a restore get keys after the restored ones, so they cannot collide.

### D-044 UX-05: recalculation polish and the "I cooked it" design

- **Recalculation panel.**
  - Before "Recalculate" is tapped, a "You will need" list shows the first four lines with an amount as they will become. In "from one product" mode the product itself is left out, since it is what you typed. Longer recipes add "and N more lines".
  - Nothing is shown while nothing changes.
  - The amount you have and its unit are on one line.
- **"I cooked it" design** (Profile → Design previews, development only), for the reactions work in Sprint 5 (BE-10 / FE-10, PRD 2.4 steps 12-14).
  - **Your dish:** an optional photo and up to 500 characters for the author, then "Send" or "Without a photo or words".
  - **Sent:** what happens next. The author gets one message, and the card shows "👨‍🍳 Cooked it".
  - **What the author sees:** the bot's message with the photo, the words and "Open the recipe".
  - **Your own recipe:** the mark is kept, and nobody gets a message (PRD 2.4: cook = author).
- **Still open for Sprint 5:** whether one cook can mark the same recipe more than once, and whether a later photo replaces the first.

### D-045 Production on one Google Cloud VM (owner's Sprint 4 answer 4)

- **Shape.** One Compute Engine VM running Docker Compose (`deploy/gcp/compose.yml`):
  - Caddy, with automatic HTTPS from Let's Encrypt, serves the built web app and passes `/api` to the API;
  - the API, the worker, and Postgres 15;
  - a one-off `migrate` step that runs before the API and the worker start.
  - Photos go to Google Cloud Storage through its S3-compatible XML API with an HMAC key, through the same S3 settings as before. SeaweedFS stays for the local demo and CI.
  - The owner deploys by following `docs/DEPLOY-GCP.ru.md`; nothing is deployed from here.
- **Images.**
  - One `deploy/Dockerfile` builds three targets: `app` (API and worker; non-root user; production dependencies only), `web` (Caddy plus the static app) and `tools` (for the storage check).
  - The CSP Report-Only header of the build goes into Caddy (docs/CSP.md).
  - Images are built on the server from the repository; nothing is pushed to a registry. CI builds them on every push to keep the Dockerfile working.
  - An optional build secret adds a CA certificate on networks that inspect TLS (this sandbox). It is never stored in an image.
- **Secrets only in `deploy/gcp/.env` on the server**, made by hand; the repository has only `.env.example` with `CHANGE_ME`.
  - Compose passes each service only what it needs: the database owner's password reaches only Postgres and the migration step.
  - In production the API, the worker and the migration tool refuse to start with:
    - the local demo's passwords or keys, or any placeholder;
    - a database password shorter than 16 characters;
    - the placeholder bot name;
    - and, for the worker, a Telegram address other than `api.telegram.org`.
  - The messages name the setting, never its value. Tests check all of this, including that the example file as it is can start nothing.
- **Cloud Storage differences.**
  - The S3 client now sends checksums only where S3 requires them (`WHEN_REQUIRED`). The SDK's newer default adds `x-amz-checksum-*` headers and a checksum flag in signed links, which S3-compatible services other than AWS often refuse.
  - Objects are deleted one by one (8 at a time). Google has recently added a multi-object delete, but single deletes work everywhere.
  - A local stand-in that refuses both is tested (`gcs-compat.test.ts`).
  - The S3 contract test can point at an existing bucket (`S3_TEST_BUCKET`, `S3_TEST_REGION=auto`, `S3_TEST_PREFIX`) without a database. On the server, `docker compose run --rm s3check` runs it against the real bucket before going live (A-25).
- **Memory, measured on this stack** (production images and settings, idle, then load: five users, four 12-megapixel photos uploaded at once, three imports at once, 200 reads, 10 timers).

  | Container   | Idle          | Peak under load (incl. cache) | Limit  |
  | ----------- | ------------- | ----------------------------- | ------ |
  | api         | 33 MB         | 232 MB                        | 320 MB |
  | postgres    | 5 MB (+cache) | 93 MB                         | 160 MB |
  | worker      | 25 MB         | 32 MB                         | 128 MB |
  | web (Caddy) | 11 MB         | 19 MB                         | 64 MB  |
  - The sum of the peaks is about 380 MB; the API's peak comes from decoding four full-size phone photos at the same moment (the app normally shrinks photos to 2048 px before upload).
  - The image library's cache is now off and it uses at most two threads.
  - Postgres runs with `shared_buffers=32MB` and 30 connections.
  - Building on the server is heavier than running: the largest single build process (the web app's typecheck and bundle) peaked at about 520 MB.
  - **Verdict:** a 1 GB e2-micro is enough to run the app for a family, with the 2 GB swap file the guide adds (for builds). The OS and Docker take an estimated 250–300 MB, not measured on a real VM. e2-small (2 GB) costs roughly 6–12 USD a month more and makes builds faster.

- **Address.** A free DuckDNS name points at the VM's ephemeral address and is updated by `duckdns.sh` every 5 minutes and at boot. That way a stopped VM costs no IP reservation, and Caddy's HTTP-01 certificate works without DNS plugins.
- **Backups.**
  - `backup.sh` runs nightly by cron: `pg_dump` in custom format, sent to a separate bucket with `gcloud`, using the VM's own service account (no key on disk).
  - That account may create and read backups but not delete them. A lifecycle rule removes them after 30 days.
  - `restore-test.sh` restores the newest backup into a temporary database, compares row counts and drops it. `restore.sh` restores for real after asking.
  - All three were run here against the production stack, with a stand-in `gcloud` that writes to a folder: the backup, the comparison, and a restore that brought deleted rows back.
- **Budget, region and costs** are in the guide: alerts at 5 and 10 USD first; a US Free Tier region (about 4 USD a month) or Europe (about 11–12 USD a month), with a note to check Google's pricing pages.

## Sprint 5

### D-046 Production safety guard: the arming switch (owner's Sprint 5 addition)

The Sprint 4 near miss: a measurement copy of the production files was restarted in production mode (a restore script ran `docker compose up -d` without the measurement override), with a made-up token shaped like a real one. Nothing was due, so nothing was sent. A fake-token check could not have caught it: the token looked real. So:

- **Arming.** The production worker starts only with `TELEGRAM_LIVE=yes`, written by hand in `.env` on the real server (DEPLOY-GCP 9.5). The deploy `.env.example` says `no`, and compose passes `${TELEGRAM_LIVE:-no}` to the worker only. Production mode alone never reaches Telegram.
- **The client checks again,** apart from the settings: the real API is called only from a production process with `TELEGRAM_LIVE=yes` in its own environment, never under the test runner, and only with a real-looking token. Any `*.telegram.org` address counts as the real one. A stand-in gets the token only on this computer or as a one-word Docker host, even when the caller allows stand-ins.
- **Fake tokens.** One rule (`isRealLookingToken`) for the API and the worker: the words the repo's fakes use, plus filler (eight equal characters after the colon). A test scans every setup file (env files, scripts, compose files, workflows, the apps' code and test helpers) and checks that production refuses each token it finds. A real token is refused by chance in roughly one case out of 15 000; the guide says what to do then (make a new token).
- **Test runs.** The API test setup stops before migrations and before any test when the environment has `NODE_ENV=production`, any `TELEGRAM_LIVE`, or a `TELEGRAM_API_BASE` that is not a local stand-in.

### D-047 The bot's chat: webhook, /start, blocking, duplicates (BE-07)

- **Webhook.** `POST /bot/webhook` on the API (`/api/bot/webhook` through Caddy). Telegram proves itself with the secret token given to `setWebhook` (`BOT_WEBHOOK_SECRET`, compared in constant time). No secret configured: no route (404). Wrong secrets are counted per IP with the failed sign-in limit. In production the secret is required: 32+ random characters, written by the guide's command.
- **Once per update.** The `update_id` goes into `tg_updates` in the same transaction as what the update changes. A repeated delivery (also at the same moment) finds it and does nothing; a failed transaction leaves nothing, so Telegram's next delivery is handled. The worker forgets ids after 7 days.
- **/start [payload]** (private chats, people only) creates or refreshes the person like sign-in does: name and username refreshed, language only for a new person, a deleted account left alone and not answered. It sets `bot_started` and queues a `bot_start` answer in the outbox (priority 0), so the reply follows the outbox rules (limits, 429, 403, retries). The answer is in the person's language with a button into the app. A payload in Telegram's alphabet is passed on as `startapp`, and `join_<code>` gets the invitation wording; anything else opens the app plainly.
- **my_chat_member** in a private chat: `kicked` → `bot_started = false`, `member` → `true`. Nobody is created from it. Other messages are recorded and get no answer yet (forwarding recipes to the bot is PRD UC-02, later).
- **Roles.** `cookbook_system` (the sign-in role) may record updates and queue only `bot_start` messages (row-level security); the user role cannot read the update log.
- **Registering the webhook** is a command, `docker compose run --rm webhook [set|info|delete]` on the server. It follows D-046: the real API only from an armed production setting, the address always `https://<DOMAIN>/api/bot/webhook`, only `message` and `my_chat_member` updates. The demo runs the same command against the stand-in.
- **The stand-in** takes `setWebhook` / `getWebhookInfo` / `deleteWebhook` (delivering only to this computer) and has buttons for /start (with a payload) and for blocking and unblocking the bot as a demo user.
