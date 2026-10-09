# Kickoff prompt for Claude Code: Family Cookbook (Telegram Mini App)

You are the lead engineer on a new product: a Telegram Mini App that works as a shared family cookbook. The full product spec is in `docs/PRD.md` (English). Read it completely before doing anything else. It is the single source of truth.

## 0. How to read the PRD

- `docs/BRIEF.md` is the author's original brief (English translation). It gives product intent and context. Where it conflicts with the PRD, the PRD wins.
- The PRD contains: user flows (section 2), an ER model with 19 tables (3), the Telegram integration architecture with server timers, outbox and notifications (4), parsing/recalculation algorithms with pseudocode (5), an MVP plan of 6 two-week sprints with task IDs BE-/FE-/UX-/QA- (6), and non-functional requirements, risks and open questions (7).
- Section 1.5 lists where the original brief contradicted itself and how those contradictions were resolved. Follow those decisions. Do not re-open them.
- Section 7.3 lists open questions, each with a default decision. Use the default unless I say otherwise.
- Section 7.5 lists assumptions about Telegram behaviour that are NOT verified. Do not treat them as facts. Create `docs/ASSUMPTIONS.md`, copy each assumption into it with a status (`unverified` / `verified-in-docs` / `needs-device-test`), and update it as you learn more. Verify against the official Telegram Bot API and Mini Apps documentation. Never invent API behaviour from memory.
- If the PRD is ambiguous or wrong, stop and ask me. Do not silently pick an interpretation on anything that affects the data model or user-visible behaviour.
- The PRD's sprint plan was written for a human team (1 backend, 1 frontend, 1 designer). You are one agent: treat a "sprint" as a scope bucket (a set of task IDs plus a demo), not as a time box. The PRD's task IDs and the Sprint column in its tables define each bucket.

## 1. Product in one paragraph

Users paste recipe text (or forward a message to the bot), and the app parses it into ingredients and steps. A recipe can be recalculated by servings or by the weight of one ingredient, with smart rounding of countable items. A cooking mode shows one step per screen with large type, swipe navigation, only the ingredients needed for the current step, and several parallel server-side timers. The bot notifies the user when a timer ends, even if the app is closed. Recipes have three visibility levels (private / shared book / by link), emotion reactions, "I cooked it" actions and no dislikes. The UI is available in ru, uk, en and sv from day one. Recipe text itself is never translated.

## 2. Tech stack (fixed unless you find a blocking problem)

- Monorepo, pnpm workspaces, TypeScript strict everywhere.
- `packages/recipe-core`: pure TypeScript library with parsing and recalculation. No I/O, no Node-only APIs, no dependencies on the DB or Telegram. It must run in both the browser and Node.
  - **Parsing must rely entirely on deterministic algorithms, regular expressions and string manipulation. Do NOT use, and do not suggest using, any LLM/AI API calls (OpenAI, Anthropic, etc.) for parsing recipe text, not in `recipe-core`, not anywhere else in the MVP.**
- `apps/api`: Node 20, Fastify, REST + Telegram webhook endpoint, Postgres 15+ (plain SQL migrations plus a typed query layer; keep the schema in migrations, not in an ORM's magic).
- `apps/worker`: timer and outbox worker. It may share a codebase with the API but must run as a separate process.
- The bot (grammY) lives in the same codebase as the API, as the PRD describes (section 4.1).
- `apps/web`: React 18 + Vite Mini App, i18next, TanStack Query, Zustand, mobile-first.
- Local dev: `docker-compose` with Postgres (and a local S3-compatible store such as MinIO). One command to start everything.
- Tests: Vitest for unit tests, plus integration tests against a real Postgres (testcontainers or the compose DB). CI on GitHub Actions: typecheck, lint, test.

## 3. Working mode (important)

1. Work one sprint at a time. Start with Sprint 1 from the MVP plan in the PRD. Do not start Sprint 2 until I say so.
2. **CRITICAL: Your very first response must contain ONLY the written plan, the proposed directory layout, and your open questions. Do NOT write or modify any files, install anything, or output any code, shell commands or configuration files, until I explicitly reply with the word "APPROVED".** Reading `docs/PRD.md` and inspecting the repository is allowed and expected. If I reply with anything other than "APPROVED" (for example, comments or corrections), revise the plan and wait again.
3. After "APPROVED", work autonomously in small, reviewable commits (conventional commit messages). Run typecheck, lint and tests before every commit.
4. Tests come first for `recipe-core`. Write the failing golden tests, then the implementation.
5. At the end of the sprint, write `docs/sprints/sprint-N-report.md` with: what was done, what was not done and why, deviations from the PRD (should be none without my approval), open questions, and a demo script I can follow. The sprint's demo line from the PRD (for Sprint 1: "Sign-in through Telegram") must be demonstrable.
6. Keep `docs/ASSUMPTIONS.md` and a `docs/DECISIONS.md` (short ADR-style entries) up to date.

## 4. Sprint 1 scope

Sprint 1 in the PRD is: **BE-01, BE-02, BE-03, FE-01, FE-02, UX-01, UX-02** (demo: sign-in through Telegram). Implement exactly those tasks, using each task's "result" text in the PRD as its acceptance description. Concretely:

1. **BE-01.** Monorepo scaffold (`apps/api`, `apps/worker`, `apps/web`, `packages/recipe-core` as an empty, buildable package), TypeScript config, ESLint/Prettier, CI, `docker-compose`, `.env.example` with startup validation of env vars, README with run instructions, migration tooling, a health endpoint, a structured logger, basic error handling with a consistent error shape.
2. **BE-02.** Telegram `initData` validation (HMAC per the official spec, including an `auth_date` freshness check), an auth middleware that reads `Authorization: tma <initData>`, the `users` table, `GET /me`. Testing rules:
   - Use a fake test-only bot token constant. Never ask me for, and never commit, a real `BOT_TOKEN`.
   - Write a test-only helper that signs an `initData` string according to the official algorithm, implemented separately from the production validator so the test is not circular.
   - Cross-check the helper once against an independent implementation (for example a short Python `hmac` script) and commit the resulting known-good vector as a constant fixture.
   - Cover: valid, tampered field, wrong token, missing hash, expired `auth_date`, malformed input.
3. **BE-03.** Books: `books`, `book_members`, `join_<code>` invitations, the keeper/member role rules from PRD 3.3 and their endpoints in 4.9 (remove a member, re-issue the invite code, leave the book; the recipe-unpublish endpoint can wait for BE-04), access rules from PRD 3.3, and Row Level Security. To implement and test the rules in 3.3 you need a minimal `recipes` table (author, book, status, visibility, share token); create only what the rules require and say so in `docs/DECISIONS.md`. The remaining recipe tables arrive with BE-04 in Sprint 2.
4. **Migrations scope.** Create migrations **only for tables that Sprint 1 tasks actually require**. Later tables arrive with the sprint that needs them, as new migrations. Do NOT create tables or constraints for Stage 2–4 features (gamification, shopping lists, public catalog, nutrition and so on). Design keys and columns so that those tables can be added later without breaking or rewriting existing structures, and note any such decision in `docs/DECISIONS.md`. Add seed data for local development. Migrations must apply to an empty DB and roll back.
5. **FE-01.** SPA skeleton: Vite, routing, Telegram SDK integration (BackButton, theme, safe area, `start_param` parsing), API client, i18n for 4 languages (ru and en filled properly; uk and sv as a first draft, files marked `needs-native-review`; language detection from `language_code`).
   - **Telegram SDK mock provider in `apps/web`.** When the app runs outside Telegram (a normal browser, `window.Telegram.WebApp` is undefined), a mock provider must inject a hardcoded development `initData` string and mock the SDK surface the app uses (for example `requestWriteAccess`, `HapticFeedback`, `BackButton`, `MainButton`, `themeParams`, `viewport`, `shareMessage`, `openTelegramLink`). The real SDK is used automatically inside Telegram. The API accepts the mock `initData` only when `NODE_ENV=development` and an explicit flag is set; in production this path must be impossible. Front-end work must be fully runnable with `pnpm dev` and no real bot.
6. **FE-02, UX-01, UX-02.** Implement the design system as code (Telegram `themeParams`, light and dark, typography, components such as buttons, chips, bottom sheet), the navigation and screens named in the PRD (book, search and filters, recipe card placeholder, "Saved", profile and language), and the book list with search, filters and "Saved". The recipe API arrives in Sprint 2, so use typed mock data behind the API client interface and keep it easy to swap. Visual design is a draft for my review; list the open design questions in the sprint report.

**Optional early start (ask, don't assume).** `recipe-core/recalc` (FE-06) has no dependencies in the PRD and is the riskiest pure logic. In your plan, say whether you recommend pulling it into Sprint 1 as a spike, and why. Do not start it without my approval.

## 5. Recalculation output contract and golden tests (applies from FE-06 and BE-06; read it now so Sprint 1 decisions stay compatible)

The recalculation engine returns structured data. Presentation is the job of the formatter, not the engine. Suggested shape (the PRD's pseudocode in 5.2 and 5.3 wins where it differs; record the final shape in `docs/DECISIONS.md`):

```ts
type Fraction = { num: number; den: number };          // reduced, e.g. 1/4, 2/3
type Quantity = {
  whole: number;                                       // integer part
  fraction: Fraction | null;                           // null if none
  rawFloat: number;                                    // exact scaled value before rounding
  unit: string | null;                                 // canonical unit code
  rounding: 'continuous' | 'spoon_cup' | 'whole_item' | 'spice_item' | 'none';
  hint?:                                               // only for whole_item (PRD 5.3)
    | { kind: 'take_fraction_of'; pieces: number; fraction: Fraction }   // "whisk <pieces>, take <fraction>"
    | { kind: 'whole_plus_fraction'; whole: number; fraction: Fraction }; // "<whole> and a <fraction> of one more"
  scalable: boolean;                                   // false for to_taste / pinch / unparsed
};
```

Never convert floats to Unicode fractions inside the engine. The formatter does that, per locale (ru: `стакана`, `ст. л.`; en; uk; sv), and has its own tests.

Golden tests, at engine level (structured) AND formatter level (ru strings):

| Input | Expected ru display string |
|---|---|
| 1.3 eggs (whole_item) | `1 шт. (или взбить 2 шт. и взять ⅔)` |
| 2.5 eggs (whole_item) | `3 шт. (или 2 шт. и ½ ещё одного)` |
| 0.7 bay leaf (spice_item) | `1 шт.` |
| 1.875 tbsp | `2 ст. л.` |
| 1.25 cup | `1¼ стакана` (engine: `{ whole: 1, fraction: {1/4}, rawFloat: 1.25 }`) |
| "salt to taste", any k | unchanged, `scalable: false` |
| "a pinch of nutmeg", any k | unchanged, `scalable: false` |

Also use the full verification tables in PRD 5.4 (the 800 g → 500 g example, k = 0.625). Add many more cases: very small and very large k, zero or empty quantities, ranges like "2–3", mixed fractions ("1 1/2", "1½"), comma and dot decimals, Cyrillic and Latin units, unknown units (kept as-is and scaled as plain numbers). Use the property tests listed in PRD 5.4. Floating-point care: never compare floats with `===`; use an explicit epsilon or rational arithmetic.

## 6. Engineering rules

- Server is authoritative for timers. A timer stores `ends_at` as an absolute timestamp, and the client renders the countdown from `ends_at` and `server_now`. The worker uses `FOR UPDATE SKIP LOCKED`, writes to a transactional outbox, and notification sending is idempotent (dedupe key).
- Handle Telegram errors explicitly: 429 (respect `retry_after`), 403 (user blocked the bot: mark and stop retrying), and webhook deduplication by `update_id`.
- The bot cannot write to a user first. Design flows around `requestWriteAccess` / `allows_write_to_pm`, as the PRD describes.
- Do not hardcode user-visible strings. Everything goes through i18n.
- Do not store secrets in the repo. Use env vars, validate them at startup (fail fast with clear messages).
- Validate all external input (zod or equivalent) at the API boundary. Return consistent error shapes.
- Keep functions small and typed. No `any` without a comment explaining why.
- Accessibility basics for the Mini App: touch targets of at least 44px, sufficient contrast, respect the Telegram theme parameters.

## 7. What you must NOT do

- Do not create real bots, call real Telegram APIs with real tokens, deploy anything, or touch cloud accounts. I will provide credentials later. Use mocks and recorded fixtures.
- Do not use LLM/AI APIs for parsing or any other MVP feature.
- Do not start tasks that belong to later sprints, and do not add features from stages 2–4 (units/density reference, "My version" fork, multi-books, gamification, OCR, shopping list, public catalog, nutrition, menu planner). If a design choice now would make them hard later, note it in `docs/DECISIONS.md`, but do not build them.
- Do not change the data model, public API shape or product behaviour without asking me first.
- Do not claim something works on iOS/Android Telegram clients. You cannot test that here. Put such items in `docs/ASSUMPTIONS.md` as `needs-device-test` and list them in the sprint report.

## 8. Definition of done for Sprint 1

- `pnpm install && docker compose up && pnpm test` works from a clean clone.
- `pnpm dev` runs the web app in a plain browser using the Telegram mock provider, and the demo "Sign-in through Telegram" works end to end against the local API with the dev `initData`.
- CI is green (typecheck, lint, tests).
- Auth tests cover every case listed in section 4.2; access-rule and RLS tests cover the matrix in PRD 3.3 (someone else's `private` recipe, a draft, link access, book membership).
- Migrations apply cleanly to an empty DB and roll back; no Stage 2–4 tables exist.
- All user-visible strings come from i18n files; key completeness is checked in CI.
- The sprint report exists, with a demo script.

Start now: read `docs/PRD.md` and `docs/BRIEF.md`, then reply with ONLY your plan for Sprint 1, the directory layout and your open questions. Then wait for "APPROVED".
