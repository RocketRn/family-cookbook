# Test plan (QA-01)

What is tested, where, and how to run it. It covers the MVP (PRD stage 1) and is updated every sprint. Real-device checks (QA-02) and load (QA-03) are listed here but run in Sprints 5–6.

## 1. Levels and where the tests live

| Level   | What                                                                                                                                                                                                                                                   | Where                                                                                 | Runs in CI                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------- |
| Engine  | Recalculation, rounding, formatting in 4 languages; golden values from PRD 5.4; properties (monotonic, idempotent, k = 1 unchanged)                                                                                                                    | `packages/recipe-core/test/{golden,properties,recalc,units,numbers,products}.test.ts` | yes                          |
| Parser  | PRD 5.1.3 table; 10 reference recipes in 4 languages with the PRD quality criterion; no word lost; 32 hostile 20,000-character inputs under 250 ms each                                                                                                | `packages/recipe-core/test/parse*.test.ts`, fixtures in `test/fixtures/import/`       | yes                          |
| API     | Every endpoint against real Postgres (15 and 16 in CI): sign-in, row-level security for other people's private recipes and drafts, roles, migrations up/down, search, import with its time limit, media with the S3 contract, rate limits, CSP reports | `apps/api/test/*.test.ts`                                                             | yes                          |
| Web     | Screens in jsdom against the API contract (fetch stubbed per route): book, search, card, editor, paste flow, recalculation, actions, i18n, dev-only screens                                                                                            | `apps/web/test/*.test.ts(x)`                                                          | yes                          |
| Static  | Typecheck, ESLint (no hard-coded UI strings), Prettier, i18n key completeness, production bundle has no dev mock or fake token                                                                                                                         | `pnpm verify`                                                                         | yes                          |
| Browser | The same flows in Chromium against the real API, database, S3, worker and the Telegram stand-in (see section 4)                                                                                                                                        | manual scripts each sprint                                                            | no (automated e2e: Sprint 5) |
| Images  | The production images build; their entry points start and refuse missing settings; Caddy's configuration is valid                                                                                                                                      | CI job "Production images"                                                            | yes                          |
| Devices | Telegram on iPhone, Android and Desktop (section 5)                                                                                                                                                                                                    | QA-02                                                                                 | no                           |
| Load    | 1000 active timers, a burst of 100 at once                                                                                                                                                                                                             | QA-03 (Sprint 6)                                                                      | no                           |

A test is written before or together with its code, and it must fail on the code before the change. Each sprint report says which tests were red first.

## 2. How to run

```bash
docker compose up -d     # Postgres 15 (dev + test databases) and SeaweedFS (S3)
pnpm verify              # everything CI runs: typecheck, lint, i18n, build, bundle check, all tests
pnpm demo                # the app on http://localhost:5173 with demo data (docs/RUN-LOCALLY.ru.md)
```

The API tests drop and recreate the schema of a database whose name contains `test`. They never touch the dev database.

Before every push: `pnpm verify` is green. Before closing a sprint: a fresh clone with `docker compose up` and `pnpm verify` is green, `pnpm demo` starts, and CI is green on Postgres 15 and 16.

## 3. Test data

- Reference recipes: `packages/recipe-core/test/fixtures/import/` (10 texts with expected results). They are written for the tests and contain no personal data.
- Real family texts: put them in the place described in [`docs/fixtures/README.md`](fixtures/README.md). Never commit personal data without the family's consent.
- Seeds: `pnpm db:seed` (three dev users, a book, a few recipes); `node scripts/demo-recipe.mjs` (a published recipe with photos).

## 4. Critical paths in a browser (each sprint, Chromium, phone width 390 px)

Start with `pnpm demo` and open `http://localhost:5173/?devUser=1`. Expected results in brackets.

| #   | Path                  | Steps                                                                                                                                                                        | Expected                                                                                                                                                                                                                             |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Sign-in and book      | Open the app                                                                                                                                                                 | The book with its recipes; no errors in the console                                                                                                                                                                                  |
| P2  | Search                | Type «яблок», then a tag filter, then a time limit                                                                                                                           | Results narrow at each step; "Found: N"; Load more continues the same search                                                                                                                                                         |
| P3  | Write a recipe        | ＋ → Write a recipe; title, 2 ingredients (one with "1,5", one "to taste"), a step; link an ingredient and "Insert into the text"; add a timer; add a 4000 px photo; Publish | The card shows the step with the amount in brackets; the photo is at most 2048 px; the timer is on the step                                                                                                                          |
| P4  | Edit                  | Edit on the card; change servings; Save                                                                                                                                      | The card shows the change; placeholders and links are intact                                                                                                                                                                         |
| P5  | Unsaved changes       | Edit, change the title, press Back                                                                                                                                           | A question appears; "no" stays, "yes" leaves                                                                                                                                                                                         |
| P6  | Paste                 | ＋ → Paste recipe text; paste a reference text; Parse                                                                                                                        | "Check the recipe" with the number of lines to check, highlighted lines with reasons, the original text; Publish puts it in the book                                                                                                 |
| P7  | Recalculate           | On a card: Recalculate → by servings ×2; then from one product (e.g. 3 eggs of 4)                                                                                            | Amounts, step amounts and servings change; timers say "time may differ"; the choice survives a reload; "Back to the original" restores                                                                                               |
| P8  | Whole-item hints      | A recipe with 1 egg and 1 garlic clove for 3 servings → 4 servings                                                                                                           | Egg: "или взбить 2 шт. и взять ⅔"; garlic: "или взять 2 зубчика и использовать ⅔"                                                                                                                                                    |
| P9  | Delete / unpublish    | As the author: Delete; as the keeper on someone else's recipe: Unpublish                                                                                                     | A question first; then the recipe is gone or private                                                                                                                                                                                 |
| P10 | Dark theme, languages | `?theme=dark`; Profile → each language                                                                                                                                       | Everything readable; no untranslated keys                                                                                                                                                                                            |
| P11 | Cook with timers      | Recipe → Cook → tick → Start; step 1 timer (1 min); Next / Back; reload; Finish                                                                                              | Recalculated amounts in the steps; the chip on every step; at zero a notice, and the message on the stand-in page (127.0.0.1:8081) within 2 s; its "Open the step" opens step 1; reload offers to continue; Done clears the progress |
| P12 | Timer offline         | Offline in the browser, start a timer; back online                                                                                                                           | "No connection" notice, then it syncs with the same id (no second timer)                                                                                                                                                             |
| P13 | Import review         | Paste a text; keep one suggested timer, skip another; remove a suggested ingredient; move a line to another section; close and reopen the paste screen                       | Decisions are saved; "Continue checking" restores the review; the original is beside the form above 720 px                                                                                                                           |
| P14 | Production stack      | `deploy/gcp/compose.yml` with throwaway secrets, through Caddy                                                                                                               | HTTPS, CSP header, `/api/health` ok, migrations ran; backup, restore test and restore work                                                                                                                                           |

Planned automation: Sprint 5 adds these as Playwright tests in CI. The full chain "import → recalculation → cooking → reaction" becomes testable once cooking mode (Sprint 4) and reactions (Sprint 5) exist.

## 5. Real devices (QA-02) and open assumptions

Each item links to its assumption in [`ASSUMPTIONS.md`](ASSUMPTIONS.md). Until a device check passes, the item is "unverified". Owner checks start at the first real Telegram test.

| Check                                                                                             | Devices                  | Assumption               | Sprint              |
| ------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------ | ------------------- |
| A photo picked on an iPhone arrives as JPEG (not HEIC), upright, at most 2048 px                  | iPhone (Telegram)        | A-20, A-24               | first Telegram test |
| Photos load from signed S3 links inside Telegram                                                  | iPhone, Android          | A-21                     | first Telegram test |
| The YouTube player plays inside Telegram and starts at the step's second                          | iPhone, Android, Desktop | A-22                     | first Telegram test |
| CSP Report-Only: no reports in normal use; `frame-ancestors` fits Telegram Web                    | all                      | A-23, [`CSP.md`](CSP.md) | first Telegram test |
| Back button asks before leaving an edited recipe; Telegram asks before closing                    | iPhone, Android, Desktop | D-035                    | first Telegram test |
| Cooking mode: screen stays on (Wake Lock), swipes, Back / Next on Desktop, return from background | all                      | A-27, D-041              | first Telegram test |
| Timer message arrives within 5 s with the app closed (≥ 20 runs); "Open the step" opens that step | iPhone, Android          | PRD 7.1, A-28            | first Telegram test |
| Photo bucket works through the S3 API (`docker compose run --rm s3check`)                         | the server               | A-25                     | first Telegram test |
| Backups reach the bucket; the restore test passes                                                 | the server               | A-26                     | first Telegram test |

## 6. Severity

| Level | Meaning                                                                  | Release                |
| ----- | ------------------------------------------------------------------------ | ---------------------- |
| P0    | Data loss, someone sees what they must not, the app does not start       | blocks everything      |
| P1    | A main path fails (create, import, recalculate, cook) with no workaround | blocks the sprint demo |
| P2    | A path works with a workaround, or a wrong but harmless display          | fixed next sprint      |
| P3    | Cosmetic                                                                 | when convenient        |

A sprint is closed only with no open P0 or P1.

## 7. PRD acceptance criteria and their tests

| PRD | Criterion                                                                                     | Test                                                                                                       |
| --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2.3 | Recalculation is instant and offline; "1.3 eggs", "0.7 bay leaf", "a pinch of salt" match 5.3 | `recipe-core/test/golden.test.ts`; `web/test/recalc.test.tsx` (no request is made while recalculating)     |
| 2.3 | Units that do not convert are refused; big change warns; k past 1/20 or 20 refused            | `web/test/recalc.test.tsx`; `recipe-core/test/recalc.test.ts`                                              |
| 3.3 | Nobody reads someone else's private recipe or draft                                           | `api/test/recipe-rls.test.ts`, `api/test/search.test.ts`                                                   |
| 5.1 | Parser quality on the reference set; linear time                                              | `recipe-core/test/parse-reference.test.ts`, `parse-safety.test.ts`; `api/test/import.test.ts` (time limit) |
| 5.3 | Rounding classes, hints, wording for eggs and other items in 4 languages                      | `recipe-core/test/recalc.test.ts`, `golden.test.ts`, `properties.test.ts`                                  |
| 7.1 | Import ≤ 20,000 characters, 10 per minute; photos ≤ 10 MB; limits per recipe                  | `api/test/import.test.ts`, `media.test.ts`, `recipes.test.ts`, `ratelimit.test.ts`                         |
| 7.1 | No hard-coded strings; all keys in 4 languages                                                | ESLint `react/jsx-no-literals`, `pnpm i18n:check`                                                          |
| 7.1 | Text is rendered as text, not HTML                                                            | `web/test/app.test.tsx` (step with `<b>`)                                                                  |
| 2.4 | Progress restored after a reload and offline; finishes on the version it started with         | `web/test/cook.test.tsx`                                                                                   |
| 4.6 | A timer fires exactly once (restart, two workers, ended while down); at most 10, 1 s to 24 h  | `api/test/timer-fire.test.ts`, `timers.test.ts`                                                            |
| 4.6 | Countdown by the server's clock; offline start syncs with the same id                         | `web/test/cook-timers.test.tsx`                                                                            |
| 4.4 | Bot text escaped; Telegram limits; 429 / 403 handled; nothing lost on restart                 | `api/test/notify-text.test.ts`, `outbox.test.ts`                                                           |
| 3.3 | Nobody else (not even in the same book) reads, cancels or extends a timer                     | `api/test/timers.test.ts` (API and directly in the database)                                               |
