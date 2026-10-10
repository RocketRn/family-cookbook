# Sprint 5 report: "After the first Telegram test"

Branch `claude/zen-brown-nifiv3`. This file is updated after every task, so the work can be picked up from the git log if a session stops.

## Progress

| #     | Task                                                               | State                                                              | Commit    |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------- |
| S5-0  | Plan and this progress file                                        | done                                                               | `50722d3` |
| S5-1  | Storage compatibility with Google Cloud Storage, and what to check | done                                                               | `a1186e5` |
| S5-2  | Production safety guard (fake tokens, stand-in addresses, arming)  | done                                                               | `3eb1329` |
| S5-3  | BE-07 bot chat handling: /start, blocked bot, duplicate updates    | done                                                               | `d628269` |
| S5-4  | BE-10 reactions and "I cooked it", the message to the author       | done                                                               | (this)    |
| S5-5  | FE-10 reactions and "I cooked it" on screen                        | next                                                               |           |
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

### S5-3 BE-07 The bot's chat: /start, blocking, duplicate deliveries

- The bot answers **/start** in the person's language with a button into the app; from an invitation link (`/start join_<code>`) it says "you've been invited" and the button opens the joining screen. The answer goes through the outbox like timer messages. **Blocking** the bot switches its messages to that person off; unblocking switches them on. Every update is handled **once**, however often Telegram delivers it (D-047).
- On the server, one command connects the bot: `docker compose run --rm webhook` (`info` shows Telegram's view and its last error, `delete` disconnects). The secret is made by the guide's `.env` command. Guide: 9.5, 9.8, the checklist (section 10), the update steps, "delete everything" and five rows in section 13.
- In the demo, the stand-in page has "Write to the bot" buttons: /start (with an invite code), block, unblock (RUN-LOCALLY 5.13). The demo connects the bot with the same command as the server.
- Red first: the webhook tests (28 of 32 failed; the 4 that passed check that nothing happens, which a missing route also satisfies), the command tests (module missing), the stand-in tests (6 failed), the deploy-file checks (2 failed).
- Checked by hand in the demo: /start with an invite as user 2 → English "invited" answer with the invite in the button; /start as user 1 → Russian welcome; block → `bot_started = false`; unblock → `true`.
- Not done here: forwarding a recipe to the bot (PRD UC-02) — the bot ignores other messages for now.

### S5-4 BE-10 Reactions and "I cooked it", the message to the author

- Reactions ❤️ 😋 🔥 💡 🤔 🔁 (one each, removable) and 👨‍🍳 "I cooked it" (any number of times, with an optional photo and up to 500 characters for the author). "My version" stays hidden. Anyone who may read the recipe may react, also from its link (D-048).
- Counts for everyone; the photo and words of "I cooked it" only for the author and the cook.
- The author gets one bot message per mark, with the photo when there is one; none for your own recipe; none when turned off (the switches come in S5-6). The database writes this message together with the mark; the app cannot write one itself.
- If Telegram cannot take the photo, the words still arrive as text.
- Red first: 23 of 25 API tests failed (the 2 that passed are "refused" checks that a missing route also satisfies), and 4 stand-in tests failed. Now 25 and 23 pass.
- Not here: the screens (S5-5) and the settings (S5-6). The guides change with the screens.
- Also recorded: the bot does not use grammY yet (D-047), a deviation from PRD 4.1, explained there.
