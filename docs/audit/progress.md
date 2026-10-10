# Audit 1: progress (resumable)

Independent, read-first audit of the whole codebase (Sprints 1–6), requested after Sprint 6 was accepted. Branch `claude/zen-brown-nifiv3`; audit started at `23ebddd`. The owner's server is pinned at `44b7852` (Sprint 5 report) for the first Telegram test, so each finding says whether that commit is affected.

**If interrupted:** read this file and `git log --oneline` first, then continue with "Next" below.

## Rules

- Read the code itself; earlier reports are not evidence.
- Each finding: severity (High / Medium / Low / Info), file and line, a concrete failure scenario, status.
- Every High and Medium is fixed with a regression test that fails on the old code, one commit per fix, `pnpm verify` before every push. Low and Info are listed, fixed only when trivial.
- No new features, no refactoring of working code, no Sprint 7. Push only this branch. No real Telegram, tokens or deployments.

## Areas

| #   | Area                                                              | State |
| --- | ----------------------------------------------------------------- | ----- |
| 1   | Authentication and sessions                                       | next  |
| 2   | Data access: RLS, roles, definer functions, SQL                   | to do |
| 3   | Bot and queue                                                     | to do |
| 4   | Uploads and storage                                               | to do |
| 5   | Parser and import                                                 | to do |
| 6   | Recalculation math                                                | to do |
| 7   | Web app                                                           | to do |
| 8   | Deployment files and docs                                         | to do |
| —   | Report (`docs/audit/audit-1-report.md`), CI on Postgres 15 and 16 | to do |

## Findings so far

| ID  | Severity | Area | Where | What can go wrong | Affects `44b7852` | Status |
| --- | -------- | ---- | ----- | ----------------- | ----------------- | ------ |

## Next

Area 1: `apps/api/src/auth/*`, `config.ts`, `prodGuard.ts`, `notify/target.ts`, the web's dev sign-in.
