# Sprint 1 report

> **Read "Review round 2" at the end first.** It corrects some statements below: Docker Compose and GitHub Actions have now been run for real, and A-01b is verified.

Scope: **BE-01, BE-02, BE-03, FE-01, FE-02, UX-01, UX-02**. Demo line: **sign-in through Telegram**.

## Summary

All seven tasks are implemented. Sign-in works end to end in a plain browser (mock Telegram provider + real API + real Postgres) and was exercised in a real Chromium. Typecheck, lint, i18n completeness, 124 tests (76 API, 48 web) and the build all pass from a clean clone. **Nothing was tested in real Telegram or on a device, and Docker Compose and GitHub Actions were not executed** (see "Not done / not verified").

## What was done

| Task     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BE-01    | pnpm monorepo (`apps/api`, `apps/worker`, `apps/web`, `packages/recipe-core`), strict TS, ESLint + Prettier, GitHub Actions CI (typecheck, lint, i18n check, test, build; Postgres 15 service container), `docker-compose` (Postgres 15 + MinIO), `.env.example` with zod validation that fails fast, README, SQL migration runner (up/down, advisory lock), `/health`, structured pino logging with `Authorization` redacted, one error shape. The worker is a skeleton with env validation.                                          |
| BE-02    | `initData` HMAC validation (constant-time compare, `auth_date` freshness, duplicate keys rejected), `Authorization: tma <initData>` middleware, `users` table, `GET /me`. Fake test token; an independent test-only signer; one cross-check against a Python `hmac` script with the committed vector `apps/api/test/fixtures/initdata-vector.json`, which the browser signer also reproduces. Cases covered: valid, tampered field, wrong token, missing hash, expired, malformed, plus future-dated, duplicate key, dev token on/off. |
| BE-03    | `books`, `book_members`, minimal `recipes`; `POST /books` (approved addition), `POST /books/join`, `GET /books/current`, `DELETE /books/current/members/:user_id`, `POST /books/current/invite/rotate`, `POST /books/leave`; keeper/member rules; RLS implementing the PRD 3.3 matrix. Migrations apply to an empty DB and roll back; a test asserts there are no tables beyond Sprint 1's four.                                                                                                                                       |
| FE-01    | Vite + React 18 + router + TanStack Query + Zustand; Telegram layer (BackButton, theme, safe area, `start_param` parsing); typed API client; i18n for ru, uk, en, sv (ru/en filled; uk/sv drafts marked `needs-native-review`); language from profile / `language_code` with manual override; **Telegram mock provider**.                                                                                                                                                                                                              |
| UX-01/02 | Design system as code: tokens from `themeParams` (light + dark), typography, Button, Chip/Tag, BottomSheet, fields, empty state, toast, tab bar. Screens: onboarding (create/join), book list with search and filters, recipe card placeholder, Saved, profile (language, members, invite, leave/remove).                                                                                                                                                                                                                              |
| FE-02    | Book list, search (title + ingredient), filters (difficulty, time, tags) and "Saved" over a typed mock behind `RecipeApi`; one export to swap in Sprint 2.                                                                                                                                                                                                                                                                                                                                                                             |

Decisions are in `docs/DECISIONS.md` (D-001..D-012); assumptions in `docs/ASSUMPTIONS.md`.

## Bugs found by running the real stack (and fixed)

Unit tests passed while these were present; a Chromium run against the real API exposed them. Bugs 1 and 2 now have regression tests that I confirmed fail without the fix.

1. The boot sequence re-ran on every route change (it depended on `navigate`, whose identity changes). Effects: `/me` re-fetched on each tab switch, "Signing in…" flashes, and after joining via a deep link the app was sent back to the join screen because `start_param` was replayed.
2. React StrictMode ran Telegram init twice concurrently, installing the mock twice (two back buttons).
3. A validation gap: a second `hash` key in `initData` was silently accepted (the first value was used). It is now rejected as malformed, with a test.
4. UX: the recipe list blanked on every keystroke while a search loaded (fixed with `keepPreviousData`), and the ru search placeholder was truncated (shortened in all four languages).

## Not done / not verified (and why)

- **Docker Compose and the GitHub Actions workflow were not run.** This environment has the Docker CLI but no daemon. I used a local Postgres 16 (compose and CI use 15). `docker-compose.yml` and `ci.yml` are written but untested; please run `docker compose up -d` and push the branch to see CI. The tests need only a Postgres and `DATABASE_URL`, so `pnpm install && docker compose up && pnpm test` should work, but I could not prove it here.
- **The Telegram documentation was unreachable** (`core.telegram.org` is blocked by the sandbox proxy), so the initData algorithm and every item in `docs/ASSUMPTIONS.md` marked `unverified` were **not** checked against official sources. Highest priority is A-01b: whether the newer `signature` field belongs in the HMAC data-check-string (we include everything except `hash`). If that is wrong, initData from a real client will fail validation.
- **No real-device or real-Telegram testing** (iOS, Android, Desktop). The items to test are listed below.
- `uk` and `sv` translations are my drafts, **not native-reviewed**.
- Not started, by design: recipe API/CRUD (Sprint 2); the `recipe-core/recalc` spike (not pulled in, as recommended); the keeper "unpublish" endpoint (BE-04); `PATCH /me` (language is local only for now); the guest `r_<token>` screen (a stub); `draft_` and `cook_` routes.

## Deviations from the PRD

None beyond the approved changes, which are already applied to `docs/PRD.md`. Small additions that are not in the PRD, flagged for your confirmation:

- a 50-member cap enforced on join (PRD 7.1 lists the limit but no error code; it returns `409 CONFLICT`);
- `GET /books/current` returns `404 NOT_IN_BOOK` for a user with no book;
- leaving or removal also clears `book_id` on link recipes (D-008).

## Open questions

1. **`users` visibility.** The restricted DB role can currently read all `users` rows (only server code runs queries). Add RLS limiting it to "me + members of my book" as defence in depth? (D-005)
2. **Link recipes of a departing author** keep working via their token but leave the book (D-008). Is that the intended reading of "their book recipes become private"?
3. **Keeper without an exit.** With no role transfer, a keeper can never leave or delete a book. Acceptable for the MVP, or add `DELETE /books/current` (keeper only, when alone)?
4. **Bot and Mini App names** (PRD 7.3 #7) are still placeholders (`your_cookbook_bot`, `cookbook`), and invitation links use them. They are needed before any real share test.
5. **Language sync.** The manual language lives in `localStorage` only. Add `PATCH /me` in Sprint 2 so bot messages (which use `users.ui_lang`) follow the chosen language?
6. **Node version.** Developed on Node 22; the target is 20 (CI uses 20). Confirm the production Node.

## Open design questions (draft visuals for your review)

1. **Contrast.** Telegram's default light button colour (`#3390ec`) with white text is about 3.3:1, below WCAG AA (4.5:1) for 16 px text. The app respects the user's theme, so it inherits this. The fallback palette used outside Telegram is darker (`#1f6fb5`). Should buttons use larger or bolder text, or enforce a darker accent when contrast is low?
2. **Recipe thumbnails** are emoji placeholders. Photo-first cards or compact text rows once real photos exist?
3. **Book screen scope.** Two chips (Whole book / Mine), and "Saved" is its own tab. Should "Mine" include private drafts (it does in the mock)? Should the count include my private recipes?
4. **Filters** live in a bottom sheet with chips, and tags are a fixed list of seven system tags. Free-form tags (PRD `custom_name`) are not in the UI yet.
5. **Profile** currently holds language, members and invitation management. A separate "Book" screen may be better once multi-book arrives.
6. **Icons** are emoji (no icon set chosen). Native-looking iOS/Android differences are untested.
7. **Tab bar vs. Telegram's own bottom bar / MainButton.** On devices with a MainButton the layout may need adjusting.
8. **Long-language fit.** ru/uk/sv strings are longer than en. I checked the Sprint 1 screens in a 390 px viewport only (UX-06 covers the full pass).

## Items needing a real device (`needs-device-test`)

BackButton behaviour (A-14); safe-area insets and notches (A-13); theme variables and live theme switch (A-12); the `openTelegramLink` share sheet and clipboard (A-15); `localStorage` persistence (A-16); a real `initData` round-trip against a real bot token (A-01, A-01b, A-01c); `requestWriteAccess` (A-04, later sprints).

## Demo script

Prerequisites: Node 20+, pnpm 10, Docker (or any Postgres with databases `cookbook` and `cookbook_test`, user `cookbook` / password `cookbook`).

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev                      # API :3000, web :5173, worker
```

1. **Sign-in through Telegram (mock).** Open <http://localhost:5173/?devUser=1>. The app boots, signs a fresh dev `initData`, calls `GET /api/me` (DevTools -> Network shows `Authorization: tma query_id=...&hash=...`) and shows the seeded book "Семья" in Russian. A banner on the Profile tab says Telegram is simulated.
2. **API directly.** `curl -H "Authorization: tma $(node scripts/dev-init-data.mjs 1)" localhost:3000/me` returns the profile. `curl -H "Authorization: tma bogus" localhost:3000/me` returns the `401` error shape.
3. **Book list, search, filters.** Type `фарш` (matches an ingredient), clear it, open **Фильтры**, choose **Легко** and apply. Open the **Сохранённое** tab. Open a recipe (a placeholder card; Cook and Recalculate are disabled as "coming soon") and use the dashed "Back (mock BackButton)" control.
4. **Language and theme.** Profile -> **English** (it persists across reloads). Add `?theme=dark` to the URL.
5. **Keeper tools.** On Profile as keeper: the members list, **Отправить приглашение** (opens a t.me share URL in a new tab), **Копировать**, **Выпустить новый код** (the old code stops working), **Удалить** a member.
6. **Member and new user.** `?devUser=2` is the seeded member (can leave; the keeper sees no leave button). `?devUser=3` has no book: onboarding offers **Create** or **Join**. For the deep link, open `?devUser=3&startapp=join_devinvitecode`: it shows the join screen, and joining lands on the book.
7. **Tests.** `pnpm test` (uses `DATABASE_URL`, default in `.env.test`): 76 API + 48 web tests. Also `pnpm typecheck`, `pnpm lint`, `pnpm i18n:check`, `pnpm build`.

Reset between demo runs: `pnpm --filter @cookbook/api db:reset && pnpm db:seed`.

## Verification evidence

- Clean clone (`git clone` + `pnpm install --frozen-lockfile`): typecheck 0 errors, lint clean, i18n check passes (4 locales, 108 keys, 3 plural groups), tests 76 + 48 pass, build passes.
- Real Chromium against the real API + Vite: sign-in, search, filters, saved, recipe placeholder, mock back button, language switch (persisted), dark theme, onboarding and deep-link join all passed after the fixes above.
- The production web bundle contains neither the mock provider nor the fake dev token. The API refuses to boot with `ALLOW_DEV_INIT_DATA=true` outside development.
- Access matrix (PRD 3.3) and RLS: `apps/api/test/rls.test.ts` (16 tests) covers someone else's private recipe, drafts, book membership, link access with and without a token, soft-deleted recipes, the keeper having no extra read or edit rights, the write rules, and no identity leaking across pooled connections.

## Review round 2

A second, independent review of Sprint 1, done after the report above. Everything below was run for real in this environment unless it says otherwise.

### What changed

- **A1, `signature` field:** the validator already dropped only `hash` (correct). Added a second Python reference vector that contains `signature`; the API validator, the TS test signer and the browser dev signer all match it, and a hash computed without `signature` is rejected. The dev mock now sends a `signature` like real clients. A-01b is marked verified, with your source.
- **A2, who can see users:** a user now sees only themselves and members of their own book, and only name, username and photo. Someone holding a share link gets only the author's name, through one narrow function. Tested, including a proof that the rules cannot loop into each other.
- **Database users:** the audit found that the API logged in as the database owner, a superuser in Docker and CI. It now logs in as a restricted user that can do nothing on its own and refuses to start otherwise (D-013).
- **A3, CI:** tests now run on Postgres 15 **and** 16 on GitHub, and CI also fails if the production web app contains the development Telegram mock.
- **Docker:** `docker compose up` was run for real. The MinIO image no longer exists on Docker Hub, so it was replaced by SeaweedFS (D-016, please confirm).
- 17 defects fixed, each with a regression test that fails on the old code (table below).

### Findings

| #   | Severity | File                                     | Problem                                                                                                                                                            | Status                                                |
| --- | -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 1   | High     | `apps/api/src/db/tx.ts`, migrations      | API connected as the table owner (a superuser in Docker and CI): "system" transactions ignored row-level security, and a `RESET ROLE` would have given owner power | Fixed (D-013)                                         |
| 2   | Medium   | `db/migrations` (`users`)                | The user role could read every user row with every column (Telegram id, notification settings)                                                                     | Fixed (D-014)                                         |
| 3   | Medium   | `apps/api/src/config.ts`                 | Production accepted the placeholder `BOT_TOKEN` from `.env.example`, so anyone could forge sign-in data if it was deployed by mistake                              | Fixed                                                 |
| 4   | Medium   | `apps/api/src/users/repo.ts`             | Signing in wrote the name and photo back into a deleted (anonymised) account (GDPR, PRD 7.1)                                                                       | Fixed                                                 |
| 5   | Medium   | `apps/api/src/books/routes.ts`           | A double tap on "Create book" or simultaneous joins returned HTTP 500; the 50-member limit could be exceeded                                                       | Fixed (D-015)                                         |
| 6   | Medium   | `docker-compose.yml`                     | `minio/minio` can no longer be downloaded, so `docker compose up` failed                                                                                           | Fixed (SeaweedFS, D-016)                              |
| 7   | Medium   | `apps/web/src/telegram/useBackButton.ts` | Back on the first screen could leave the app (it counted browser history from before the app opened)                                                               | Fixed                                                 |
| 8   | Medium   | `apps/web/src/screens/ProfileScreen.tsx` | When loading the book failed, Profile said "You are not in a book yet"                                                                                             | Fixed                                                 |
| 9   | Low      | `apps/api/src/auth/initData.ts`          | A nonsensical `auth_date` (e.g. 10^20) passed the freshness check; `user.id` had no upper bound (500 on overflow). Both still needed a valid Telegram signature    | Fixed                                                 |
| 10  | Low      | `apps/api/test/initData.test.ts`         | The "missing `auth_date`" test never reached that code; a missing `user` field was not tested                                                                      | Fixed                                                 |
| 11  | Low      | Saved, Recipe and Book screens           | No error state on Saved; Recipe said "not found" on a network error; Book showed a bare retry button                                                               | Fixed                                                 |
| 12  | Low      | `apps/api/src/app.ts`                    | `x-request-id` was copied unbounded into logs and responses                                                                                                        | Fixed                                                 |
| 13  | Low      | `apps/api/src/db/migrate.ts`             | Editing an already-applied migration went unnoticed; a missing `.down.sql` was found only at rollback                                                              | Fixed (D-017)                                         |
| 14  | Low      | CI                                       | "No dev mock in the production bundle" was checked by hand once                                                                                                    | Fixed (`pnpm check:bundle` in CI)                     |
| 15  | Low      | `scripts/check-i18n.mjs`, locales        | API error `BAD_REQUEST` had no translated message, and nothing tied API error codes to translations                                                                | Fixed                                                 |
| 16  | Low      | `apps/web/index.html`                    | Page title was hard-coded English                                                                                                                                  | Fixed                                                 |
| 17  | Low      | Telegram header colour                   | Telegram's header did not match the page colour                                                                                                                    | Fixed (needs device check, A-19)                      |
| 18  | Info     | Sprint 1 report                          | It said CI never ran; it did run (and passed) after the Sprint 1 push                                                                                              | Corrected here                                        |
| 19  | Info     | CI, runtime                              | Node 20 reached end of life on 2026-04-30 (GitHub also warns)                                                                                                      | Not fixed: stack decision for you (Sprint 2 question) |
| 20  | Info     | API                                      | PRD 7.1 rate limits (60 requests/min per user, import 10/min) are not built; no Sprint 1 task covers them                                                          | Not fixed: proposed for a later sprint                |

Checked and found correct: constant-time hash comparison, `auth_date` freshness, duplicate keys, malformed user JSON, the API refusing `ALLOW_DEV_INIT_DATA` outside development, `SET LOCAL` / `set_config(..., true)` only inside transactions, no cross-book leaks, invite code hidden from non-keepers, share-token behaviour per PRD 3.3, migrations from an empty database, no `NOT NULL` column added without a default.

Open questions from the first report: Q1 is done (D-014). Q2 and Q3 are closed with PRD defaults (D-019). Q4, Q5 and Q6 are in the Sprint 2 plan.

### Verification (exact numbers)

- **Clean clone** of the pushed branch (commit `9516b80`), `pnpm install --frozen-lockfile`: typecheck 0 errors; lint clean; i18n check passed (4 languages, 109 keys, 3 plural groups); tests **121 API + 56 web = 177 passed, 0 failed**; build passed; bundle check passed.
- **Docker, run for real here:** `docker compose up` from the clean clone (Postgres 15.19 + SeaweedFS 4.48); migrate, seed and all 177 tests passed against it; S3 upload and download with the dev keys worked, and a wrong key was rejected.
- **GitHub Actions** run #2 (commit `9516b80`): all three jobs green: checks (typecheck, lint, i18n, build, bundle check), tests on Postgres 15.19, tests on Postgres 16.15 (121 + 56 each).

### Still not verified

- **Real Telegram and real phones (iOS, Android, Desktop):** nothing has been opened in Telegram yet. That needs a bot and an HTTPS address (a later sprint).
- **Telegram documentation:** this agent still cannot open `core.telegram.org`. Only A-01b is verified (by you). Other `unverified` items in `docs/ASSUMPTIONS.md` remain so.
- **Ukrainian and Swedish texts:** not reviewed by native speakers.
- **Production setup:** hosting, real S3 + CDN, backups. Planned for later sprints.

### What you need to do yourself

1. **See the automatic checks on GitHub.** Open <https://github.com/RocketRn/family-cookbook>. Click the **Actions** tab (top row). In the left list click **CI**. Click the newest run named after the latest commit. A green circle with a tick means everything passed; a red cross means something failed (click it to see which step). The tool here could not log in with `gh`, so I read the results through the GitHub connector instead.
2. **Create the bot (when you are ready; not needed for Sprint 2).** In Telegram open **@BotFather** -> send `/newbot` -> type a display name (e.g. _Семейная книга_) -> type a username that ends in `bot` (e.g. `family_cookbook_bot`). BotFather replies with a **token**: keep it in a password manager and **never** send it in chat, email or GitHub. Send me only the **username** and the short name you want for the Mini App (e.g. `cookbook`). The Mini App itself is registered later, when there is an HTTPS address.
3. **Native review of translations.** On GitHub open `apps/web/src/i18n/locales/uk.json` (Ukrainian) and `sv.json` (Swedish), click **Raw**, and send the link to a native speaker. Ask them to check only the text on the right of each `:` and to send corrections in any form.
4. **Answer the Sprint 2 questions** (below), at least the ones marked _needed_.

### По-русски: что нужно сделать вам

1. **Посмотреть автоматические проверки на GitHub.** Откройте <https://github.com/RocketRn/family-cookbook>, вкладка **Actions** (верхний ряд), слева **CI**, затем верхний (самый новый) запуск. Зелёная галочка: всё прошло. Красный крестик: что-то упало, нажмите на него, чтобы увидеть шаг.
2. **Создать бота (когда будете готовы; для Sprint 2 не нужно).** В Telegram откройте **@BotFather** -> `/newbot` -> название (например, _Семейная книга_) -> имя пользователя, оканчивающееся на `bot` (например, `family_cookbook_bot`). BotFather пришлёт **токен**: сохраните его в менеджере паролей и **никогда** не присылайте его в чат, почту или GitHub. Мне нужны только **имя бота** и короткое имя мини-приложения (например, `cookbook`).
3. **Проверка переводов носителями языка.** На GitHub откройте `apps/web/src/i18n/locales/uk.json` (украинский) и `sv.json` (шведский), нажмите **Raw** и отправьте ссылку носителю языка. Проверять нужно только текст справа от `:`.
4. **Ответить на вопросы к Sprint 2** (хотя бы помеченные _needed_).
