# Sprint 5 report: "After the first Telegram test"

Branch `claude/zen-brown-nifiv3`. This file is updated after every task, so the work can be picked up from the git log if a session stops.

## Progress

| #     | Task                                                               | State                                                              | Commit    |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------- |
| S5-0  | Plan and this progress file                                        | done                                                               | `50722d3` |
| S5-1  | Storage compatibility with Google Cloud Storage, and what to check | done                                                               | `a1186e5` |
| S5-2  | Production safety guard (fake tokens, stand-in addresses, arming)  | done                                                               | `3eb1329` |
| S5-3  | BE-07 bot chat handling: /start, blocked bot, duplicate updates    | done                                                               | `d628269` |
| S5-4  | BE-10 reactions and "I cooked it", the message to the author       | done                                                               | `850b4e0` |
| S5-5  | FE-10 reactions and "I cooked it" on screen                        | done                                                               | `f2e2a04` |
| S5-6  | Notification settings, and the new-recipe message (off by default) | done                                                               | `5b82582` |
| S5-7  | FE-09 timers, full version                                         | done                                                               | `e2ae9c7` |
| S5-8  | Saved recipes                                                      | done                                                               | `2e31248` |
| S5-9  | QA-01 automated browser tests in CI                                | done                                                               | (this)    |
| —     | Fixes from the first Telegram test                                 | placeholder: the owner sends the findings later as a separate task |           |
| S5-10 | Wrap-up: clean clone, CI, guides, report, Sprint 6 plan            | next                                                               |           |

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

### S5-5 FE-10 Reactions and "I cooked it" on screen

- The card's reactions block is live: ❤️ 😋 🔥 💡 🤔 🔁 with counts, yours pressed, a second tap removes it; "👨‍🍳 Cooked N times" and "You cooked it N times"; "My version" is gone. The author also sees "Who cooked it": name, date, photo and words.
- "👨‍🍳 I cooked it" (from the card or from cooking's Done screen, then tied to that cooking session): an optional photo (the editor's photo field), up to 500 characters, "Send" or "Without a photo or words", then "Sent!". For your own recipe the screen says nobody gets a message. The texts now say the author may have turned these messages off (quiet mode, S5-6). Texts in all four languages.
- Red first: 10 of 10 new web tests failed. Two older tests described the old behaviour and were updated: the Sprint 2 "markup only" reactions block, and the greyed-out "I cooked it" on the Done screen. The design preview's "sent" text was also updated.
- Checked in a browser on the demo: user 2 reacted and marked "I cooked it" with a photo and words; the author's bot message with the photo reached the stand-in 1.0 s later (PRD: within 10 s), and its photo link opened (291 KB). The author's card showed "Who cooked it" with the photo and words.
- Guides: RUN-LOCALLY 5.3, 5.11, 5.12 and a new 5.14 with two screenshots; DEPLOY-GCP section 10 checklist "Reactions and I cooked it", with what to send if the photo does not arrive.

### S5-6 Notification settings, and the new-recipe message

- Profile → "Notifications": quiet mode, "someone cooked my recipe" (on by default), "a new recipe in the book" (off by default). Each switch saves at once; timer messages always arrive (D-049).
- A recipe that reaches the book sends "📖 {Name} added «{title}»" to the members who turned it on, about 5 minutes later. More than three at once become one message ("New recipes in the book: N"); a recipe taken back before then sends nothing.
- Red first: 12 of 19 API tests and 4 of 4 web tests failed. Two of the 7 that passed on the old code passed only because the test's recipes could not be published (no ingredient); the helper now checks that the recipe was created, and they test what they say.
- Guides: RUN-LOCALLY 5.15 (new), DEPLOY-GCP checklist "Notifications".

### S5-7 FE-09 Timers, full version

- A step's timer starts from the recipe card, without cooking mode; running timers show in a panel at the bottom of the card, with +1 min and Cancel (D-050).
- "⚠️ … message not delivered" on a timer whose bot message failed, with "Open the bot"; the app asks the server again 5 s and 60 s after zero.
- Three short beeps at zero (Web Audio), prepared by the tap that starts the timer.
- Red first: 7 of 7 new web tests failed. One older test compared the card's timer chip text exactly and now includes the ▶ of the start button.
- Checked in a browser on the demo with the bot blocked for user 1: a 1-minute timer from the card rang at 61.9 s and showed "message not delivered" at 66.8 s.
- Guides: RUN-LOCALLY 5.12 (card timer, sound, "not delivered"); DEPLOY-GCP checklist: the card timer, the sound on each device and in silent mode, "not delivered" after blocking the bot.

### S5-8 Saved recipes

- "🔖 Save" on someone else's recipe puts it on your "Saved" shelf; the "Saved" tab lists it, newest saved first, with search; tapping again removes it. A saved recipe you may no longer read is not shown (D-051).
- The development sample shelf is gone.
- Red first: 6 of 6 API tests and 5 of 6 web tests failed (the one that passed checks that your own recipe has no "Save", which the old card also satisfied). Two older tests described the sample shelf and were replaced; one navigation test now uses the real shelf.
- Not here: the book's filter sheet on the "Saved" tab (the API takes the filters already).
- Guides: RUN-LOCALLY 5.10, DEPLOY-GCP checklist "Saved".

### S5-9 QA-01 Browser tests in CI

- 15 Playwright tests (`e2e/`) drive Chromium at phone width through the main paths of the test plan, against the real stack: API, database, photo storage, worker and the Telegram stand-in. One is PRD QA-01's chain by two people: the keeper pastes a recipe text, checks it and publishes it; a member doubles it, cooks it with a timer (the bot's message arrives, its button opens the step), marks "I cooked it" with a few words; the author gets the bot's message and sees it on the card. The others: book and search, languages and dark theme, writing a recipe with a 4000 px photo, editing, leaving unsaved changes, deleting, recalculation from one product and the egg/garlic hints, timers from the card, offline and with the bot blocked, reactions, "Saved", notification settings, and the bot's answer to /start (D-052; `docs/QA.md` section 4 maps paths to files).
- CI job "Browser tests" starts the stack with the owner's command `pnpm demo` (so the demo script is checked too) and runs `pnpm e2e`; on failure it keeps the report, screenshots and step recordings for 7 days. Locally: RUN-LOCALLY 7.1.
- A test fails on any browser console error or an API answer of 500 or more. No retries. The tests' recipes carry "E2E ·" and are deleted at the end.
- All 15 passed three runs in a row on the demo here (about 55 s each).
- What the browser tests found, each fixed with a test that failed first:
  - **The bot stand-in after a demo restart.** It numbered Telegram updates from 1 again, and the API (correctly) ignores a number it has seen, so after `pnpm demo:stop` and `pnpm demo` the "/start" and "block the bot" buttons did nothing. It now numbers them from the clock. Red first: the new stand-in test got 1 after 3.
  - **The card's timer panel.** A timer stays in the server's list for 15 minutes after it ends, and the panel kept at the bottom of every card kept showing it ("✅ … ready!"), also on other recipes, covering the card's buttons. The panel now shows running timers, "not delivered" ones and ones that ended while the card was open (D-050 clarified); cooking mode is unchanged. Red first: the new web test saw the old timer on the card.
- Request limits: the robot clicks far faster than a person, so the test stack raises the per-person and per-address limits; the PRD limits themselves are unchanged and tested in the API tests. Without the raised limits, a run fails with a 429 message that says what to do.
- Noticed, not changed (for Sprint 6): the card's timer panel shows a timer by its name only, so a running timer of another recipe can look like this recipe's; the recalculation hints for whole items ("or whisk 2 pcs and take ⅔") are written in the interface language, with English unit names next to a Russian recipe's "шт.".
