# Sprint 5 report: "After the first Telegram test"

Scope: storage compatibility, a production safety guard, **BE-07** the bot's chat, **BE-10 / FE-10** reactions and "I cooked it", notification settings, **FE-09** timers in full, the "Saved" shelf, and **QA-01** browser tests in CI.

Branch `claude/zen-brown-nifiv3`, last code commit `d5b6578`. This file was updated after every task, so the work could be picked up from the git log if a session stopped.

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
| S5-9  | QA-01 automated browser tests in CI                                | done                                                               | `d5b6578` |
| —     | Fixes from the first Telegram test                                 | placeholder: the owner sends the findings later as a separate task |           |
| S5-10 | Wrap-up: clean clone, CI, guides, report, Sprint 6 plan            | done                                                               | (this)    |

## In one paragraph

The family can now talk back:

- **Reactions and "I cooked it".** ❤️ 😋 🔥 💡 🤔 🔁 on every recipe, and "👨‍🍳 I cooked it" with an optional photo and a few words. The author gets the bot's message with the photo, and sees "Who cooked it" on the card. Nobody gets a message for their own recipe.
- **The bot answers.** /start in the person's language, with a button into the app (also from an invitation link). It notices when someone blocks it, and handles each Telegram delivery once.
- **Notifications** in the Profile: quiet mode, "someone cooked my recipe" (on), "a new recipe in the book" (off; a message 5 minutes later, several at once become one).
- **Timers, full version:** start from the recipe card, "⚠️ message not delivered" when the bot could not write, three beeps at zero.
- **Saved:** "🔖 Save" on someone else's recipe, and the "Saved" tab with search. The sample shelf is gone.
- **Safety:** the production worker sends to Telegram only when `TELEGRAM_LIVE=yes` is written by hand on the server; the tests cannot start a production worker; fake tokens are refused. Photo storage settings for Google Cloud Storage are pinned by tests and explained in the guide.
- **Browser tests in CI:** 15 Playwright tests click through the main paths on every push, including the whole chain "import → recalculation → cooking → reaction". They found two bugs, both fixed.

**Nothing has been deployed, and nothing has been tried in real Telegram or on a phone.** All bot messages went to the local stand-in.

## What was built

| Commit      | Task               | What it does                                                                                                                                                                |
| ----------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `50722d3`   | Plan               | This file: the plan, your answers, and a progress table updated after every task.                                                                                           |
| `a1186e5`   | Storage            | Google Cloud Storage settings pinned by tests and set in the deploy files; what to check on Cloud Storage in the guide (9.7).                                               |
| `3eb1329`   | Safety guard       | `TELEGRAM_LIVE=yes` needed to send for real; one fake-token rule; the Telegram client refuses on its own; test setups refuse production settings (D-046).                   |
| `bec0bfe`   | Fix (CI #29)       | A timer started in the instant cooking opened was erased from the device's copy. Found by CI, reproduced, fixed with a test.                                                |
| `d628269`   | BE-07              | The bot's webhook: /start (also with an invitation), blocked and unblocked bot, each update once; `docker compose run --rm webhook` connects the bot on the server (D-047). |
| `850b4e0`   | BE-10              | Reactions and "I cooked it" in the database and the API; the author's bot message with the photo, written together with the mark (D-048).                                   |
| `f2e2a04`   | FE-10              | The reactions block, the "I cooked it" screen (from the card or the Done screen), "Who cooked it" for the author.                                                           |
| `5b82582`   | Notifications      | Profile switches and the "new recipe" message with collapsing (D-049).                                                                                                      |
| `e2ae9c7`   | FE-09 full         | Timers from the card, "message not delivered", sound (D-050).                                                                                                               |
| `2e31248`   | Saved              | The personal shelf, for real (D-051).                                                                                                                                       |
| `d5b6578`   | QA-01              | 15 browser tests in CI; two bugs they found, fixed (D-052).                                                                                                                 |
| this commit | Wrap-up and report | This report, the demo script, the Sprint 6 plan.                                                                                                                            |

## Your answers and additions, and how they were applied

| #   | You said                                                      | Done                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "I cooked it" many times; show "cooked N times"               | Any number of marks; the card shows "👨‍🍳 Cooked N times" for everyone and "You cooked it N times" for you.                                                                                                                               |
| 2   | Message to the author on by default, quiet mode, none for own | On by default; Profile → "Quiet mode" and "Someone cooked my recipe"; your own recipe never sends one, and the screen says so.                                                                                                          |
| 3   | New-recipe message off by default, switch in the Profile      | Off for everyone (also for people who existed before); "A new recipe in the book" in the Profile; about 5 minutes after publishing; more than three at once become one message.                                                         |
| 4   | Browser tests in CI, 3–4 minutes more is fine                 | A parallel CI job of about 2 minutes (Chromium 18 s, the demo 25 s, the 15 tests 44 s on run #37). The whole run still takes about 2 minutes, because the jobs run side by side.                                                        |
| 5   | First Telegram test not done; do not wait                     | Not waited for. The fixes from it stay a placeholder task for when you send the results.                                                                                                                                                |
| +   | Storage compatibility, with what to check on Cloud Storage    | Pinned by tests; a guide section with a check command, a log search after the first photo, and a table of symptoms and fixes.                                                                                                           |
| +   | A production safety guard; a test that fails without it       | `TELEGRAM_LIVE=yes` by hand on the server; the client refuses real Telegram inside any test run and with any fake-looking token; the test setup stops before touching anything when it sees production settings. 8 + 4 cases red first. |
| +   | Commit and push after every task, progress kept current       | 11 task commits, each pushed after `pnpm verify`; the progress table above was updated in each.                                                                                                                                         |

## Demo script: "Reactions, I cooked it, Saved"

In the project folder: `pnpm demo:stop`, `git pull`, then `pnpm demo`. No reset is needed: the database changes apply themselves. The Russian guide has the same steps: [`RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md) sections 5.10, 5.12–5.15.

1. Open the bot page <http://127.0.0.1:8081>. Choose Dev Member (100000002), press **«Нажать /start»**: within a second or two, "👋 Hello! This is your family cookbook…" with "Open the cookbook".
2. Open <http://localhost:5173/?devUser=2> (Dev Member, English). Open «Шарлотка (демо)».
   - Tap ❤️: "Love it: 1", pressed. Tap again: back to 0. Tap it once more.
   - Tap **🔖 Save** under the author's name: "🔖 Saved". The **Saved** tab now lists it, with search.
3. On the card, tap **👨‍🍳 I cooked it**. Add any photo, write a few words, tap **Send** → "Sent!".
   - The bot page shows the message to Dev Keeper (100000001) **in Russian, with your photo** about a second later.
4. Open <http://localhost:5173/?devUser=1> (Dev Keeper, Russian) in another window, open the charlotte: "Кто приготовил" with the photo and the words, "Приготовили 1 раз", and the heart.
5. Timer from the card (still as Dev Keeper): tap **«⏱ Взбивать · 1 мин ▶»** on step 1. A panel at the bottom counts down; at zero a large notice, three beeps, and the bot's message.
6. On the bot page press **«Заблокировать бота»** for Dev Keeper and start the timer again: after it rings, the panel says **«⚠️ Взбивать · сообщение не доставлено»** with "Open the bot". Then **«Разблокировать»** and **«Нажать /start»**.
7. Profile → **Уведомления**: quiet mode greys out the two switches; every switch is saved at once.
8. Optional: the robot does all of this and more in about a minute: RUN-LOCALLY 7.1 (`pnpm e2e`).

## Verification (exact numbers)

- **Locally, Node 24.21.0** (`pnpm verify`, on `d5b6578`):
  - typecheck (now also the browser tests) and lint clean;
  - i18n: 4 languages, **414 keys** (397 after Sprint 4), 5 plural groups;
  - build and the bundle check passed (no dev mock or fake token in the production bundle);
  - **tests: 296 recipe-core + 476 API + 187 web + 24 stand-in = 983 passed, 0 failed** (790 after Sprint 4).
- **Browser tests** (`pnpm e2e`, Chromium, 390 px): **15 of 15 passed, three runs in a row** on the demo here, about 55 s each.
- **Clean clone** of the pushed branch at `d5b6578`, `pnpm install --frozen-lockfile`, and **Docker Compose** (Postgres **15.19** and SeaweedFS) on spare ports, with no `.env`:
  - `pnpm verify` against that database: **983 passed**, including the S3 contract test;
  - from the same clone, `pnpm demo:reset` (empty data), then `pnpm demo`: ready in 19 s on the default ports;
  - `pnpm e2e` against it: **15 of 15 passed** in 56 s. That covers this report's demo script, except the photo in the author's message, which was checked by hand in S5-5 (the message with the photo reached the stand-in 1.0 s after "Send").
- **GitHub Actions:** runs **#27–#37**, one per push. All green except **#29**: a test failed on Postgres 16 only, which found a real bug (problem 1 below), fixed in #30. From #37 the run has five jobs: checks, tests on Postgres 15 and 16, the production images, and **Browser tests** (about 2 minutes: Chromium 18 s, the demo 25 s, the tests 44 s).
- **By hand on the demo:** /start in English and Russian, blocking and unblocking (S5-3); "I cooked it" with a photo, the author's message 1.0 s later with the photo (S5-5); a 1-minute card timer with the bot blocked rang at 61.9 s and showed "not delivered" at 66.8 s (S5-7).
- **Tests that failed on the old code first** (each task's notes below have the numbers): storage settings, the safety guard (8 + 4 cases), the CI #29 race (8 of 8), the webhook (28 of 32), reactions (23 of 25), the reactions screens (10 of 10), notifications (12 of 19 API, 4 of 4 web), card timers (7 of 7), Saved (6 of 6 API, 5 of 6 web), the stand-in's update numbers, the card's timer panel.

## Problems found and fixed this sprint

1. **A timer erased the moment cooking opened** (CI #29, Postgres 16 only, about 1 in 25 runs). Cooking mode wrote the state it opened with, so a timer started in that instant was lost from the device's copy (the server timer and its message were fine). Fixed; a new test failed 8 of 8 before and passes 8 of 8; the test that failed in CI passed 40 of 40.
2. **The bot stand-in after a demo restart** (found by the browser tests). It numbered Telegram updates from 1 again, and the API rightly ignores a number it has seen, so "/start" and "block" did nothing after `pnpm demo:stop` and `pnpm demo`. Now numbered from the clock. Only the stand-in was affected; real Telegram's numbers always grow.
3. **The card's timer panel** (found by the browser tests). For 15 minutes after a timer ended, the panel at the bottom of every card kept "✅ … ready!", also on other recipes, and covered the card's buttons. Now the card shows running timers, "not delivered" ones and ones that ended while it was open. Cooking mode is unchanged.
4. **Tests that passed for the wrong reason** (found while writing S5-6): two notification tests passed on the old code only because their recipes could not be published. The helper now checks that the recipe was created.
5. **A demo left running keeps the old server after `git pull`.** Here the demo ran an API older than the code for a while, and the browser tests showed it as a 404 on "Save". `pnpm demo` on a running demo only says "already running". Not a product bug, but the guide said only "`git pull`": it now says `pnpm demo:stop`, `git pull`, `pnpm demo` (RUN-LOCALLY section 2).

## Not done, or not verified

- **Real Telegram, phones, Google Cloud:** nothing tried. Open assumptions in [`docs/ASSUMPTIONS.md`](../ASSUMPTIONS.md); each has a line in the guide's checklist (DEPLOY-GCP section 10). New this sprint: the bot's answer to /start on the server, the photo in the author's message, the sound on each phone and in silent mode.
- **Forwarding a recipe to the bot** (PRD UC-02, "forward → draft"): the bot ignores other messages for now.
- **Sharing a recipe into a Telegram chat** (BE-12 `savePreparedInlineMessage`) and **the screen for someone who opens a recipe link** (FE-11): the link still shows "coming soon".
- **The bot is written without grammY** (PRD 4.1), with plain HTTP calls (D-047). Everything it needs works; the deviation is recorded.
- **The "Saved" tab has search but not the filter sheet** (the API takes the filters already).
- **Ukrainian and Swedish texts:** 17 new keys this sprint (414 in all), not reviewed by native speakers.
- **Load test (QA-03)** and **observability (BE-14)**: Sprint 6.

## What you need to do yourself

1. **Check CI:** <https://github.com/RocketRn/family-cookbook> → **Actions** → **CI** → the newest run: all five jobs green, including "Browser tests".
2. **Try the demo:** `pnpm demo:stop`, `git pull`, `pnpm demo`, then the demo script above (or the Russian one below).
3. **If you already set up the server:** the update adds two lines to `.env` (DEPLOY-GCP section 12) and one command that connects the bot.
4. **The first Telegram test** (when you are ready): DEPLOY-GCP from the top, then send me the checklist from section 10. Never paste a token or key into a chat, including with me.
5. **Translations:** `uk.json` and `sv.json` to a native speaker (as before).
6. **Answer the Sprint 6 questions** below and reply "APPROVED".

## По-русски: что сделано и что нужно от вас

**Что появилось.**

- **Реакции и «Я приготовил(а)».** Под каждым рецептом ❤️ 😋 🔥 💡 🤔 🔁 и кнопка «👨‍🍳 Я приготовил(а)»: можно добавить фото блюда и пару слов. Автор получает сообщение от бота с этим фото и видит в карточке «Кто приготовил». За свой рецепт сообщения нет. Отметок «приготовил» может быть сколько угодно: в карточке «Приготовили N раз».
- **Бот отвечает.** На /start — приветствие на языке человека и кнопка в приложение, в том числе по ссылке-приглашению. Бот замечает, что его заблокировали, и снова пишет после разблокировки.
- **Уведомления в Профиле.** «Тихий режим», «Кто-то приготовил мой рецепт» (включено), «Новый рецепт в книге» (выключено; если включить — сообщение через 5 минут после публикации, несколько сразу собираются в одно).
- **Таймеры целиком.** Таймер можно запустить прямо из карточки рецепта. Если бот не смог написать, таймер покажет «⚠️ … сообщение не доставлено». Когда таймер доходит до нуля, звучат три коротких сигнала.
- **«Сохранённое».** Чужой рецепт можно сохранить кнопкой «🔖 Сохранить», он появится на вкладке «Сохранённое» с поиском.
- **Защита.** Фоновый процесс на сервере отправляет сообщения в настоящий Telegram, только если в `.env` вручную написано `TELEGRAM_LIVE=yes`. Тесты не могут запустить «боевой» процесс. Поддельные токены отклоняются.
- **Автоматические проверки в браузере.** После каждой отправки кода робот за минуту проходит 15 сценариев, в том числе всю цепочку «вставить текст → пересчитать → готовить с таймером → «Я приготовил(а)» → сообщение автору». Он уже нашёл две ошибки, обе исправлены.

**Ничего не запущено на сервере и не проверено в настоящем Telegram или на телефоне.** Все сообщения бота уходили только на страницу-имитацию.

**Как посмотреть (сценарий показа).** В папке проекта: `pnpm demo:stop`, `git pull`, затем `pnpm demo`. Подробно, с картинками: [`RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md), разделы 5.10, 5.12–5.15.

1. Откройте страницу бота <http://127.0.0.1:8081>. Выберите Dev Member (100000002) и нажмите **«Нажать /start»**: через секунду-две придёт приветствие на английском с кнопкой.
2. Откройте <http://localhost:5173/?devUser=2> (Dev Member, английский интерфейс) и рецепт «Шарлотка (демо)». Нажмите ❤️. Нажмите **«🔖 Save»**: рецепт появится на вкладке **Saved**.
3. В карточке нажмите **«👨‍🍳 I cooked it»**, добавьте любое фото и пару слов, нажмите **Send**. Через секунду на странице бота появится сообщение для Dev Keeper — по-русски и с вашим фото.
4. Откройте <http://localhost:5173/?devUser=1> (Dev Keeper) в другом окне и ту же шарлотку: «Кто приготовил» с фото и словами, «Приготовили 1 раз».
5. Нажмите в карточке на таймер шага **«⏱ Взбивать · 1 мин ▶»**: внизу появится обратный отсчёт; через минуту — крупная плашка, три сигнала и сообщение бота.
6. На странице бота нажмите **«Заблокировать бота»** для Dev Keeper и снова запустите таймер: после звонка он покажет **«⚠️ Взбивать · сообщение не доставлено»**. Потом **«Разблокировать»** и **«Нажать /start»**.
7. **Профиль → Уведомления**: включите «Тихий режим» — два других переключателя станут серыми.

**Что сделать вам:**

1. Проверьте на GitHub: Actions → CI → у последнего запуска зелёная галочка (теперь там пять заданий, включая «Browser tests»).
2. Посмотрите новое в демо по сценарию выше.
3. Если сервер уже настроен: при обновлении добавьте в `.env` две строки и подключите бота одной командой (DEPLOY-GCP, раздел 12).
4. Когда будете готовы к настоящему Telegram, идите по [`DEPLOY-GCP.ru.md`](../DEPLOY-GCP.ru.md) сверху вниз и пришлите мне таблицу из раздела 10. **Никогда не присылайте токен бота, ключи и пароли**, даже на снимках экрана.
5. Отдайте `uk.json` и `sv.json` носителям языка (17 новых строк).
6. Ответьте на вопросы плана Sprint 6 и напишите «APPROVED».

## Proposed Sprint 6 plan: "Ready for the family" (waiting for your APPROVED)

Sprint 6 is the last sprint of the PRD's first stage. Same rules: tests first, one commit and push per task, `pnpm verify` before every push, CI green on Postgres 15 and 16 with the browser tests, a clean clone at the end, both guides kept current, no real Telegram calls, tokens or deployments from me.

| #     | Task                                       | Result                                                                                                                                                                                                                          |
| ----- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S6-0  | Plan and progress file                     | This plan, your answers, a progress table updated after every task.                                                                                                                                                             |
| S6-1  | Fixes from the first Telegram test         | Carried over. Done first as soon as you send the checklist (DEPLOY-GCP section 10); it may push the last tasks below to Sprint 7.                                                                                               |
| S6-2  | BE-07 forward → draft (PRD UC-02)          | Forward a recipe text to the bot: it reads it with the same parser as "Paste", keeps it as your private draft, and answers with a button that opens "Check the recipe". Only for people in a book; long texts and spam refused. |
| S6-3  | BE-12 + FE-11 sharing a recipe             | "Share" on the card sends the recipe into a Telegram chat with a button (prepared inline message, with a "copy link" fallback). The screen for someone who opens a "by link" recipe replaces "coming soon".                     |
| S6-4  | BE-14 observability and alerts             | A "timer delay" figure (end → message sent) in the logs and in `/api/health`; a guide section for a free Google Cloud uptime check that emails you when the app is down; what to look at when a message is late.                |
| S6-5  | QA-03 worker load                          | 1000 running timers and a burst of 100 ending at the same second, on the production stack with the stand-in: every message once, delays measured against Telegram's limits.                                                     |
| S6-6  | FE-12 + UX-06 polish                       | First-run hints, error and offline states reviewed on every screen, haptics; a browser test that the longest texts (Ukrainian, Swedish) fit at 320 px.                                                                          |
| S6-7  | Small things found in Sprint 5             | The filter sheet on the "Saved" tab; the recipe's name next to a timer of another recipe in the card's panel; the whole-item hint language (question 4).                                                                        |
| S6-8  | BE-13 usage figures (if you say yes, q. 3) | Counts only (recipes added, imported, cooked, timers), no texts, for a monthly summary only you can see.                                                                                                                        |
| S6-9  | CSP decision                               | After the first test's reports: switch the content security policy from "report only" to enforced, or keep reporting with the reasons written down.                                                                             |
| S6-10 | Wrap-up                                    | Clean clone, CI, both guides, the Sprint 6 report with a Russian section and a demo script, and a short "before you invite the family" checklist (UX-07 usability test with 3–5 people is yours).                               |

**Questions:**

1. **Forward → draft:** if the forwarded message has a photo, attach it as the draft's photo, or ignore photos for now?
2. **A recipe opened by link** by someone outside your book: read, recalculate and cook (with timers) — yes? Should they also be able to save it and react, or only read and cook?
3. **Usage figures (S6-8):** do you want anonymous counts for a monthly summary, or skip it?
4. **Whole-item hints** ("or whisk 2 eggs and take ⅔") are written in the reader's interface language, so an English reader of a Russian recipe sees "2 pcs" next to "1 шт.": keep the reader's language, or use the recipe's?
5. **The bot library:** keep the plain HTTP calls that work now (less code), or switch to grammY as PRD 4.1 says (no visible change)?

## Appendix: the plan as approved

### The owner's answers (Sprint 5 approval)

1. "I cooked it" can be marked several times; the card shows "cooked N times".
2. A message to the author when someone cooks their recipe: on by default, with a quiet mode in the Profile. No message when you cook your own recipe.
3. A message to the whole book when a new recipe is published: off by default, with a switch in the Profile.
4. Automated browser tests in CI: yes (3–4 more minutes per run).
5. The first Telegram test has not been done: it is not waited for. Its fixes are a placeholder above.

Additions:

- Storage compatibility done pre-emptively, with what to check on Google Cloud Storage written down.
- A production safety guard after the Sprint 4 near miss, with a test that fails without it, and test setups that cannot start a production worker by accident.
- A commit and a push after every task, and this progress section kept current.

### Working rules (unchanged)

- Tests first, failing on the old code. Because every task is pushed and `pnpm verify` runs before every push, each task's tests and code go into one commit; the report records that the tests were run red before the code.
- One commit per task. CI green on Postgres 15 and 16. A clean-clone check with Docker Compose at the end.
- No real Telegram calls from the sandbox, no real tokens, no deployments.

## Appendix: task notes, written after each task

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
