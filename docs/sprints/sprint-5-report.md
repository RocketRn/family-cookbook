# Sprint 5 report: "After the first Telegram test"

Branch `claude/zen-brown-nifiv3`. This file is updated after every task, so the work can be picked up from the git log if a session stops.

## Progress

| #     | Task                                                               | State                                                              | Commit    |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------- |
| S5-0  | Plan and this progress file                                        | done                                                               | `50722d3` |
| S5-1  | Storage compatibility with Google Cloud Storage, and what to check | done                                                               | `a1186e5` |
| S5-2  | Production safety guard (fake tokens, stand-in addresses, arming)  | done                                                               | (this)    |
| S5-3  | BE-07 bot chat handling: /start, blocked bot, duplicate updates    | next                                                               |           |
| S5-4  | BE-10 reactions and "I cooked it", the message to the author       | to do                                                              |           |
| S5-5  | FE-10 reactions and "I cooked it" on screen                        | to do                                                              |           |
| S5-6  | Notification settings, and the new-recipe message (off by default) | to do                                                              |           |
| S5-7  | FE-09 timers, full version                                         | to do                                                              |           |
| S5-8  | Saved recipes                                                      | to do                                                              |           |
| S5-9  | QA-01 automated browser tests in CI                                | to do                                                              |           |
| —     | Fixes from the first Telegram test                                 | placeholder: the owner sends the findings later as a separate task |           |
| S5-10 | Wrap-up: clean clone, CI, guides, report, Sprint 6 plan            | to do                                                              |           |

## The owner's answers (Sprint 5 approval)

1. "I cooked it" can be marked several times; the card shows "cooked N times".
2. A message to the author when someone cooks their recipe: on by default, with a quiet mode in the Profile. No message when you cook your own recipe.
3. A message to the whole book when a new recipe is published: off by default, with a switch in the Profile.
4. Automated browser tests in CI: yes (3–4 more minutes per run).
5. The first Telegram test has not been done: it is not waited for. Its fixes are a placeholder above.

Additions:

- Storage compatibility done pre-emptively, with what to check on Google Cloud Storage written down.
- A production safety guard after the Sprint 4 near miss, with a test that fails without it, and test setups that cannot start a production worker by accident.
- A commit and a push after every task, and this progress section kept current.

## Working rules (unchanged)

- Tests first, failing on the old code. Because every task is pushed and `pnpm verify` runs before every push, each task's tests and code go into one commit; the report records that the tests were run red before the code.
- One commit per task. CI green on Postgres 15 and 16. A clean-clone check with Docker Compose at the end.
- No real Telegram calls from the sandbox, no real tokens, no deployments.

## Task notes

### S5-1 Storage compatibility with Google Cloud Storage

- The client already sent checksums only when S3 requires them and used path-style addresses (Sprint 4, D-045). Now that is pinned by a test, and also set as AWS SDK variables in `deploy/gcp/compose.yml` for the API, the worker and the storage check (`s3check`).
- Red first: `storage-config.test.ts` failed with the two settings taken out of `storage.ts` (`expected 'WHEN_SUPPORTED' to be 'WHEN_REQUIRED'`); the new `deploy-files.test.ts` check failed on the old `compose.yml`.
- The S3 contract test stays green on SeaweedFS; the Google Cloud Storage stand-in test (it refuses checksum headers and multi-object delete) stays green.
- `docs/DEPLOY-GCP.ru.md` 9.7 now says what to check on Google Cloud Storage: a command that shows the four settings, a log search after the first photo, and a table of symptoms, causes and fixes. Section 13 points to it.

### S5-2 Production safety guard

- The Sprint 4 near miss had a made-up token that looked real, so a fake-token check alone could not have stopped it. The production worker now also needs `TELEGRAM_LIVE=yes`, written by hand in `.env` on the real server; the deploy example says `no` (D-046).
- The Telegram client checks again on its own: the real API only from an armed production process, never from a test run, never with a fake-looking token; any `*.telegram.org` address counts as real; a stand-in only on this computer or the Docker network.
- One fake-token rule for the API and the worker, and a scan of every setup file: production refuses each token found there.
- The API test setup stops before migrations and before any test when the terminal has `NODE_ENV=production`, `TELEGRAM_LIVE` or a non-local `TELEGRAM_API_BASE`. Checked by hand: `NODE_ENV=production` and `TELEGRAM_LIVE=yes` runs both stop with "Refusing to run the tests…".
- Red first: on the old code the worker started in production without `TELEGRAM_LIVE` (8 cases), the client was created for the real API inside a test run and sent the token to non-local stand-ins (4 cases), and the deploy files had no switch. The worker entry point was also run in production mode with a made-up real-looking token and no switch: it exits with code 1 and names `TELEGRAM_LIVE`, without printing the token.
- Guide: the switch in the `.env` step (9.5) with a check command, a one-time line for an existing `.env` in "Обновить приложение", and two rows in section 13.

### Fix: a timer erased the moment cooking opened (found by CI #29)

- CI #29 (S5-2) failed on Postgres 16 only, in a web test: the timer chip was on screen but the saved progress had no timer. Reproduced locally about once in 25 runs.
- Cause: cooking opened at a step writes its state once when the screen opens, and it wrote the state it opened with. A timer started before that write (a tap in the instant the step appeared) was erased from the device's copy. It is now written from the current state.
- Red first: a new test taps "Start timer" as soon as the button is in the page; it failed 8 of 8 runs before the fix and passes 8 of 8 after; the test that failed in CI passed 40 of 40 runs after the fix.
