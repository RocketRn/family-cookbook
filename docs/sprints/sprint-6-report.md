# Sprint 6 report: "Ready for the family"

Branch `claude/zen-brown-nifiv3`. This file is updated after every task, so the work can be picked up from the git log if a session stops.

## Progress

| #     | Task                                                                       | State                                                                    | Commit    |
| ----- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------- |
| S6-0  | Plan, this progress file, the bot library decision                         | done                                                                     | `119365a` |
| S6-1  | Fixes from the first Telegram test                                         | placeholder: the owner sends the findings later as a separate small task |           |
| S6-2  | Forward a recipe to the bot → a private draft; webhook secret proven       | done                                                                     | `2452a46` |
| S6-3  | The screen for someone who opens a recipe link (guest)                     | done                                                                     | `d223223` |
| S6-3b | Sharing a recipe into a Telegram chat ("Share")                            | done                                                                     | `57e889b` |
| S6-4  | Observability: the timer delay figure, health, an uptime alert             | done                                                                     | `b6b18a5` |
| S6-5  | QA-03 worker load: 1000 timers, 100 at once                                | done (found and fixed slow sending in a burst)                           | `34b5f2b` |
| S6-6  | Polish: first-run hints, error and offline states, haptics, long texts     | done (found and fixed 5 layout problems and 2 offline ones)              | (this)    |
| S6-7  | Small Sprint 5 findings: Saved filters, timer's recipe name, hint language | next                                                                     |           |
| S6-8  | Usage counts                                                               | **not built** (owner's answer 3)                                         |           |
| S6-9  | CSP decision                                                               | placeholder: after the first Telegram test's reports                     |           |
| S6-10 | Wrap-up: clean clone, CI, guides, report, "before you invite the family"   | to do                                                                    |           |

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

### S6-2 Forward a recipe to the bot → a private draft

- Forward a recipe text to the bot (or type it there): it becomes a private draft of the sender, read by the same parser as "Paste"; the bot answers "📝 I saved … to your drafts" with **Check the recipe**, which opens the review with the original text (D-054).
- Untrusted input, as the owner asked: text only (photos, files, stickers and captions get "I can only read text"); at most 4096 characters; only for people who already opened the app (a new `users.app_opened_at`, stamped by the app's sign-in; /start alone does not count); at most 30 an hour per person, deleted ones included, then one "too many" answer an hour; the same parser time limit as "Paste"; the draft written as the sender under row-level security. The same text again gets "already in your drafts", not a second draft. Other commands (/help) are ignored.
- One transaction per update records it, writes the draft and queues the answer, switching database roles inside it, so a failure leaves nothing and Telegram's retry is handled once.
- Webhook security (owner's addition): already built in Sprint 5; new tests prove that a forwarded recipe without the secret header or with a wrong one is refused (401) and nothing is stored, that every call is checked, and that neither the secret nor the bot token reaches the log (all requests logged at the most detailed level).
- Pasted drafts keep their review notes on the server too, so "Check the recipe" works for both and on any device (`GET /recipes/:id/import`, author only, until the draft is saved).
- The stand-in has a "forward to the bot" form, and a new browser test goes from that form to the published recipe.
- Red first: 22 of 30 new API tests failed (the 8 that passed check that nothing happens: strangers, groups, other bots, refusals, the log), 3 web tests and 2 stand-in tests failed.
- Guides: RUN-LOCALLY 5.13 (item 4) and 7.1; DEPLOY-GCP checklist "Переслать рецепт боту", a note in "Обновить приложение", a row in section 13. Test plan P15.

### S6-3 A recipe opened by its link, by someone outside the book

- The `r_<token>` link now opens the recipe (it said "coming soon"): someone outside the book reads it, recalculates it and cooks it with timers; the bot's timer message works as for anyone. No saving, no reactions, no "I cooked it" (owner's answer 2). The author and members of the book get the usual card. A link that opens nothing says "This link no longer works" (D-055).
- The server enforces it: timers and cooking sessions take the link's token (the same row-level security as reading); reactions no longer accept it, so a guest cannot react through the API either. The Sprint 5 test "someone with the link may react" now checks the opposite, by the owner's answer.
- Cooking keeps the token on the device, so cooking opened again from the timer's message still works.
- Red first: 6 of 6 new API tests (and the updated reaction test) and 6 of 6 web tests failed. A new browser test opens a link as demo user 3 (outside the book, Swedish) and gets the timer's message.
- The guide sections come with the "Share" button (S6-3b), which is how the author gets the link.

### S6-3b Sharing a recipe into a Telegram chat

- **"Share"** on a published recipe (in the book or shared by link): a sheet says who the link opens it for, with **Send to a chat** and **Copy link**. The server prepares a message with `savePreparedInlineMessage` (the cover photo or the title, the author, an "Open the recipe" button, in the sharer's language) and the app sends it with Telegram's `shareMessage`, so the chat shows the recipe, not the app's generic card. Without it (an older Telegram, the bot not set up, Telegram refused) Telegram's share screen gets the link (D-056).
- The API calls Telegram only through the guarded client, armed by the same `TELEGRAM_LIVE=yes` as the worker, now passed to the API in `compose.yml`; without it the API still starts and "Share" gives the link. A test proves that even an armed setting never reaches Telegram from a test run.
- The stand-in prepares messages too and shows them on its page ("Поделились рецептом"), with a button that opens the recipe as dev user 3 (outside the book): the demo can show the whole path, and a browser test follows it.
- Not verified: how Telegram shows the prepared message on each phone (A-29, PRD 4.7 asks to check with a test bot): in the first-test checklist.
- Red first: 6 of 6 API tests, 6 of 6 stand-in tests, 5 of 7 web tests (the 2 that passed check that a draft and a private recipe have no button, which the old card also satisfied), and the deploy-file check.
- Guides: RUN-LOCALLY 5.16 (new: Share and the guest), DEPLOY-GCP 9.5 (what the switch also does) and checklist "Поделиться рецептом". Test plan P16.

### S6-4 How late timer messages are, and an alert when the app stops

- Each timer message now carries its timer's end, and the worker logs how late it went (`timer message sent`, `delayMs`).
- `GET /health/full` (on the server `https://<DOMAIN>/api/health/full`): the database, whether the worker keeps up (messages due for more than 2 minutes and not tried), and the last hour's timer messages: sent, late (over 5 s, PRD 7.1), failed, and p50 / p95 / max delay. 503 when something is wrong. Only counts and times. `GET /health` stays Docker's plain check (D-057).
- The guide's new step 9.10 sets up Google's uptime check on that page, e-mailing the owner, with a way to test it; two new rows in section 13 say what to do when the e-mail comes or messages are late.
- Red first: 8 of 8 new API tests failed. One Sprint 4 test compared the timer message's contents exactly and now includes its end.

### S6-5 The worker under load (QA-03)

- A new API test (`apps/api/test/worker-load.test.ts`, runs in CI on Postgres 15 and 16): 100 people, 10 running timers each (1000), one of each person's timers ending in the same second. Two real worker processes send through the Telegram stand-in, which now answers 429 above 30 messages a second, as Telegram does.
- **Found:** every message went exactly once and the other 900 timers were untouched, but sending was slow: the last message 18.5 s after its timer ended, half of them over 8.8 s, 73 of 100 over the PRD's 5 s. The sender put a message off for half a second whenever the bot-wide pace (one message every 40 ms) had just been used, and idled between full batches.
- **Fixed** (D-058): a short wait for the bot-wide pace is waited out; the worker takes the next batch at once while more is due. Now, three runs: the last message 4.4–4.6 s late, half within 2.4–2.6 s, none over 5 s, no 429.
- Red first: the load test (18.5 s), and 3 of 4 new sender tests; the stand-in's new 429 test. One Sprint 4 test ("5 a second") expected the old putting-off and now expects the wait.

### S6-6 Polish: no connection, buzzes, first-run tips, long texts

- **No connection** (D-059): a note at the top of every screen; what was loaded stays; a screen not loaded before says it will load when the connection is back, then loads. **Found:** such a screen showed "Recipe not found" or "No recipes yet", and a tap waited silently; now a tap says "No connection" at once.
- **Buzzes:** the same rule everywhere (a tick for a choice, "success" when something is done, "error" when something fails). Publishing, saving, deleting, a failed tap and a failed paste had none.
- **First-run tips:** one on the book (forward a recipe to the bot), one on the card ("Recalculate"), one in cooking (timers keep going with the app closed), each until "Got it".
- **Long texts at 320 px** (UX-06): a new browser test opens every main screen and sheet in Ukrainian, Swedish and Russian, plus a recipe with the longest texts a person writes. **Found and fixed:** the editor's unit chip cut "ingen enhet" (sv); a step's timer on a recalculated card (sv) and a long timer label in cooking mode made the screen scroll sideways; a title with one long word did the same; "Stop cooking" and "Finish" were both "Завершити" (uk). The first version of the check found nothing because of a mistake in it; a self-check now plants a broken button and requires it to be reported.
- Red first: 4 of 4 offline tests, 5 of 5 buzz tests, 3 of 3 tip tests, the timer-label test and the uk button-name test failed on the old code. The 320 px test first failed on the problems above. RUN-LOCALLY 5.17; QA.md P17 and the test map.
