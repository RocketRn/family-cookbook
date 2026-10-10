# Sprint 6 report: "Ready for the family"

Branch `claude/zen-brown-nifiv3`. This file is updated after every task, so the work can be picked up from the git log if a session stops.

## Progress

| #     | Task                                                                       | State                                                                    | Commit |
| ----- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| S6-0  | Plan, this progress file, the bot library decision                         | done                                                                     | (this) |
| S6-1  | Fixes from the first Telegram test                                         | placeholder: the owner sends the findings later as a separate small task |        |
| S6-2  | Forward a recipe to the bot → a private draft; webhook secret proven       | next                                                                     |        |
| S6-3  | Sharing a recipe, and the screen for someone who opens a recipe link       | to do                                                                    |        |
| S6-4  | Observability: the timer delay figure, health, an uptime alert             | to do                                                                    |        |
| S6-5  | QA-03 worker load: 1000 timers, 100 at once                                | to do                                                                    |        |
| S6-6  | Polish: first-run hints, error and offline states, haptics, long texts     | to do                                                                    |        |
| S6-7  | Small Sprint 5 findings: Saved filters, timer's recipe name, hint language | to do                                                                    |        |
| S6-8  | Usage counts                                                               | **not built** (owner's answer 3)                                         |        |
| S6-9  | CSP decision                                                               | placeholder: after the first Telegram test's reports                     |        |
| S6-10 | Wrap-up: clean clone, CI, guides, report, "before you invite the family"   | to do                                                                    |        |

## The owner's answers (Sprint 6 approval)

1. Forwarded recipes: text only; photos are ignored for now.
2. Someone outside the book who opens a "by link" recipe may read it, recalculate it and cook it with timers. No saving and no reactions for now.
3. Anonymous usage counts: skipped. S6-8 is not built.
4. Whole-item hints stay in the reader's interface language (PRD rule), but the unit word inside a hint uses the same language as the ingredient line it belongs to, so a line never mixes "2 pcs" and "1 шт.". With tests.
5. The bot keeps its plain HTTP code; no grammY. The decision and the reasons are in DECISIONS.md (D-053).

The first Telegram test is not finished and is not waited for: S6-1 and S6-9 stay placeholders, and the owner sends the findings later as a separate small task.

Additions:

- **Webhook security**, for forwarding and the existing /start: Telegram's secret-token header (`X-Telegram-Bot-Api-Secret-Token`) is checked on every webhook call, a call without it is refused, and neither the bot token nor the secret is ever logged. Already built in Sprint 5 (D-047); S6-2 adds tests that prove each part.
- **Forwarded text is untrusted input:** a length cap, a per-person rate limit, the same linear-time parser with the same time limit, text only (everything else ignored), only for people who already opened the app, and the draft is private to that person.
- A commit and a push after every task, and this progress table kept current.

## Working rules (unchanged)

- Tests first, failing on the old code; the report records which tests were red first. Each task's tests and code go into one commit, pushed after `pnpm verify`.
- CI green on Postgres 15 and 16, with the browser tests. A clean-clone check with Docker Compose at the end.
- `docs/RUN-LOCALLY.ru.md` and `docs/DEPLOY-GCP.ru.md` updated for anything that changes.
- The Sprint 6 report: a Russian section, a demo script and a "before you invite the family" checklist.
- No real Telegram calls from the sandbox, no real tokens, no deployments. Push the branch, never `main`.

## Task notes
