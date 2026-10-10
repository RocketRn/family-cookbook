# Audit 1: progress (resumable)

Independent, read-first audit of the whole codebase (Sprints 1–6), requested after Sprint 6 was accepted. Branch `claude/zen-brown-nifiv3`; audit started at `23ebddd`. The owner's server is pinned at `44b7852` (Sprint 5 report) for the first Telegram test, so each finding says whether that commit is affected.

**If interrupted:** read this file and `git log --oneline` first, then continue with "Next" below.

## Rules

- Read the code itself; earlier reports are not evidence.
- Each finding: severity (High / Medium / Low / Info), file and line, a concrete failure scenario, status.
- Every High and Medium is fixed with a regression test that fails on the old code, one commit per fix, `pnpm verify` before every push. Low and Info are listed, fixed only when trivial.
- No new features, no refactoring of working code, no Sprint 7. Push only this branch. No real Telegram, tokens or deployments.

## Areas

| #   | Area                                                              | State                   |
| --- | ----------------------------------------------------------------- | ----------------------- |
| 1   | Authentication and sessions                                       | done: no High or Medium |
| 2   | Data access: RLS, roles, definer functions, SQL                   | next                    |
| 3   | Bot and queue                                                     | to do                   |
| 4   | Uploads and storage                                               | to do                   |
| 5   | Parser and import                                                 | to do                   |
| 6   | Recalculation math                                                | to do                   |
| 7   | Web app                                                           | to do                   |
| 8   | Deployment files and docs                                         | to do                   |
| —   | Report (`docs/audit/audit-1-report.md`), CI on Postgres 15 and 16 | to do                   |

## Findings so far

| ID   | Severity | Area | Where                                               | What can go wrong                                                                                                                                                                                                                                                                                                     | Affects `44b7852` | Status                                                                                                                                                                           |
| ---- | -------- | ---- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1-1 | Low      | 1    | `apps/api/src/auth/initData.ts:111`, `config.ts:44` | PRD 4.3 asks for a separate, configurable freshness window for write operations; one 24 h window covers reads and writes. An `initData` copied off a device (a screenshot of developer tools, a shared HAR file) lets someone write as that person for up to 24 h. No recorded decision (A-01c covers only the 24 h). | yes               | open: needs your decision (a short write window would also refuse saves from someone who keeps the app open while cooking, because Telegram fixes `initData` when the app opens) |
| A1-2 | Info     | 1    | `apps/api/src/auth/plugin.ts:50`                    | Every signed-in request writes the `users` row (name, photo, last seen). One extra write per request; recorded as acceptable at family scale (D-007).                                                                                                                                                                 | yes               | no change                                                                                                                                                                        |
| A1-3 | Info     | 1    | `apps/api/src/auth/initData.ts:112`                 | `auth_date` more than 60 s ahead of the server clock is refused, so a server clock running slow by over a minute refuses every sign-in. Google's VMs keep time by NTP.                                                                                                                                                | yes               | no change                                                                                                                                                                        |

## Next

Area 2: every migration in `db/migrations/` (tables, RLS policies, grants, SECURITY DEFINER functions), `apps/api/src/db/roles.ts`, every SQL string in `apps/api/src` (anything built from input), share tokens, timers, cook sessions, saved, reactions.

## Area notes

**Area 1 (checked and fine):** HMAC exactly per Telegram (`signature` kept in the data-check-string, only `hash` dropped); duplicate keys refused; constant-time comparison over every token; `auth_date` bounded to 12 digits, 24 h old at most, 60 s in the future at most; neither token can be empty; the dev token is accepted only with `NODE_ENV=development` and `ALLOW_DEV_INIT_DATA=true` (the config refuses the flag elsewhere); production refuses placeholder tokens, keys and passwords; the production image and Compose both set `NODE_ENV=production` and the flag to false; the web mock is dev-only and the CI bundle check forbids it; `initData` stays in memory and the Authorization header (redacted from logs); a deleted account is never revived; the Bot API client sends the token only to `api.telegram.org` from an armed production process outside a test run, and otherwise only to a local stand-in; the test setup refuses production settings. Tests cover all of these.
