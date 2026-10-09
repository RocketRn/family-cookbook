# Sprint 4 report: "Cook with timers"

Scope:

- **BE-08:** the outbox, the message sender and a local Telegram stand-in.
- **BE-09:** server timers and cooking sessions.
- **FE-08:** cooking mode.
- **FE-09:** timers on screen (core).
- **FE-05:** the full import review.
- **UX-05:** recalculation polish and the "I cooked it" design.
- **Deployment:** the Google Cloud files and the Russian guide [`docs/DEPLOY-GCP.ru.md`](../DEPLOY-GCP.ru.md).

Branch `claude/zen-brown-nifiv3`, last commit before this report `2b6c1a1`.

## In one paragraph

A family member can now cook from the app:

- **Cooking mode.** "Cook" on a recipe opens "Do you have everything?" with the recalculated list to tick off. Then comes one step per screen, with large text and amounts that follow the recalculation. Back / Next buttons and swipes move between steps, and the screen stays on.
- **Timers.** A timer button on a step starts a timer **on the server**. Chips show every running timer on every step, with "+1 min" and "Cancel". When a timer ends, the bot sends "⏰ Тушить — готово!" with a button that opens that step, even if the app is closed. Without a connection the timer runs on the phone and syncs later.
- **Progress** survives a reload, a closed app and a lost connection.
- **Paste review.** Pasting a recipe now offers every timer and ingredient it found as a suggestion to keep or skip. It shows the original text beside the form and continues where you left off.
- **Bot messages** go only to a local stand-in that shows them on a page; no real Telegram call was made, and there is no bot token anywhere.
- **Deployment guide.** For your first real test there is a click-by-click Russian guide for one Google Cloud server, with all the files it needs. I measured the memory, tested the backups and checked the production settings. **Nothing has been deployed, and nothing has been tried in real Telegram or on a phone yet.**

## What was built

| Commit      | Task                     | What it does                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aeb470b`   | Tests first              | Timer API, firing, outbox, bot text and privacy tests, and the Telegram stand-in (`apps/fakebot`). Committed **red**.                                                                                                                                                                                                                                                               |
| `9295c89`   | BE-08 (+ BE-09 database) | <ul><li>Migration 0007: timers, cooking sessions, the outbox and rate gates, with row-level security, plus a trigger that allows a timer to fire only once.</li><li>The `cookbook_worker` database role.</li><li>Firing in one statement.</li><li>The sender: Telegram's limits, 429 / 403 / 400 handling, nothing lost on restart.</li><li>Escaped message text (D-039).</li></ul> |
| `9e299e5`   | BE-09                    | <ul><li>Timer API: start, list, +1 min, cancel; 10 per person, 1 s to 24 h; offline starts.</li><li>Cooking sessions.</li><li>Sign-in records whether the bot may write.</li><li>Worker loops, and settings that refuse to send anywhere but a local stand-in outside production.</li><li>`pnpm demo` starts the stand-in (D-040).</li></ul>                                        |
| `61d648f`   | FE-08                    | Cooking mode: preparation, steps, swipes, Wake Lock, progress on the device with a copy of the recipe, the Done screen ("My version" hidden), and timer message links that open the step (D-041).                                                                                                                                                                                   |
| `1bbc491`   | FE-09 (core)             | <ul><li>Timer buttons, and a countdown by the server's clock.</li><li>Chips on every step, +1 min and cancel.</li><li>The alarm at zero.</li><li>Offline timers with a notice.</li><li>Asking Telegram before the first timer whether the bot may write (D-042).</li></ul>                                                                                                          |
| `09e7534`   | FE-05                    | Full import review: suggestions to keep or skip, the original text beside the form, moving lines between sections, and continuing later (D-043).                                                                                                                                                                                                                                    |
| `4ffbfa4`   | UX-05                    | A "You will need" preview in the recalculation panel, and the "I cooked it" design at `/dev/cooked` (D-044).                                                                                                                                                                                                                                                                        |
| `18bb64b`   | Deployment               | <ul><li>`deploy/Dockerfile` and `deploy/gcp/` (Caddy, api, worker, web, Postgres 15).</li><li>Cloud Storage compatibility.</li><li>Production guards.</li><li>Measured memory limits.</li><li>Backups with a restore test.</li><li>DuckDNS.</li><li>The Russian guide.</li><li>CI builds the images (D-045).</li></ul>                                                              |
| `2b6c1a1`   | Wrap-up                  | <ul><li>A fix for a timer race found under load.</li><li>The demo recipe has a 1-minute timer.</li><li>The stand-in's message buttons open the demo at that step.</li><li>Sticky buttons reach the bottom edge.</li><li>The Russian demo guide and the test plan updated.</li></ul>                                                                                                 |
| this commit | Report                   | This report.                                                                                                                                                                                                                                                                                                                                                                        |

## Your answers and additions, and how they were applied

| #   | You asked                                                      | Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bot: a local stand-in, sent messages visible in the demo       | <ul><li>`apps/fakebot` imitates `sendMessage` with Telegram's answers, including 429, 403 and refusal of bad HTML. Its page at <http://127.0.0.1:8081> shows the messages. Each button opens the demo at that step.</li><li>The worker refuses `api.telegram.org` outside production, and refuses to send the token to any other host than a local stand-in. **No real Telegram call, no bot token.**</li></ul>                                                                                                                                                                                |
| 2   | Up to 10 running timers per person, 1 s to 24 h                | <ul><li>Enforced by the API, with a lock per person so ten taps at once cannot make an eleventh, and again by the database.</li><li>Tested with 10 parallel requests: exactly the free places are given.</li></ul>                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | Hide "My version"                                              | Hidden on the Done screen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | Deployment guide and files for one Google Cloud VM             | <ul><li>[`docs/DEPLOY-GCP.ru.md`](../DEPLOY-GCP.ru.md) and `deploy/`: Caddy with automatic HTTPS, api, worker, web, Postgres 15.</li><li>Photos in Cloud Storage via HMAC keys and the existing S3 settings; SeaweedFS only for the demo and CI.</li><li>The guide covers: budget alerts at 5 and 10 USD **before** anything else, region and costs, DuckDNS, BotFather, swap, nightly backups with a restore test, the secrets rules, the first Telegram test checklist, and stop / rollback. Details below.</li></ul>                                                                        |
| +   | A timer fires exactly once, enforced in the database           | <ul><li>A trigger allows only running → fired or cancelled, and fired → failed. The fire time never changes.</li><li>A unique key `timer:<id>` on the outbox.</li><li>Firing uses `FOR UPDATE SKIP LOCKED`.</li><li>Tested:<ul><li>two workers with 40 timers;</li><li>a worker restart;</li><li>a timer that ended while the worker was down (fires once on restart, about 600 s late, logged as late);</li><li>a duplicate inserted by hand (refused).</li></ul></li></ul>                                                                                                                   |
| +   | Bot text escaped for the parse mode                            | <ul><li>HTML parse mode. Titles and labels are cleaned of control and direction characters, cut on a grapheme boundary (64 characters for a title, 100 for a label), HTML-escaped and wrapped in Unicode isolates. Placeholders are filled in one pass.</li><li>Tested with HTML, Markdown, entities, emoji (never split), Hebrew and Arabic, a direction override and 200-character titles.</li><li>The stand-in refuses the same malformed HTML Telegram would.</li></ul>                                                                                                                    |
| +   | Telegram limits, 429 / 403, nothing lost on restart            | <ul><li>Pace: one message per chat per second, 25 per second for the whole bot, shared through the database by all workers.</li><li>429: waits `retry_after`, and it does not count as a failure.</li><li>403: that person's messages stop and are recorded as "blocked"; `bot_started` is set to false; their timers are marked "failed".</li><li>400: not retried.</li><li>Other errors back off 1 s, 5 s, 30 s, 5 min.</li><li>A message claimed by a worker that dies is sent by another after 30 s.</li><li>The stand-in simulates 429 and 403, and all these paths are tested.</li></ul> |
| +   | Cooking progress and timers user-scoped, RLS-protected, tested | <ul><li>Row-level security on timers and cooking sessions. The user role cannot change a timer directly; cancel and +1 min go through two database functions limited to the caller's own running timer.</li><li>Tested: a member of the same book and an outsider get 404 for cancel, +1 min and the list. Directly in the database, another user sees 0 rows, cannot insert in someone's name ("row-level security") and cannot update ("permission denied").</li></ul>                                                                                                                       |

## Demo script: "Cook with timers"

In the project folder: `git pull`, then `pnpm demo`. If you ran the demo before this sprint, run `pnpm demo:reset` once first: it erases the demo data, and the demo recipe gets a 1-minute timer. The Russian guide has the same steps with screenshots: [`RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md), sections 5.12 and 5.13.

1. Open «Шарлотка (демо)».
   - **Recalculate** → 12 servings.
   - Before you tap, "You will need" already shows «Яйца 8 шт.», «Сахар 2 стакана». Tap **Recalculate**.
2. **Cook.** "Do you have everything?" lists the doubled amounts. Tick two lines and tap **Start cooking**.
3. Step 1 reads «Взбейте яйца (**8 шт.**) с сахаром (**2 стакана**)…». Tap **⏱ Start timer: Взбивать, 1:00**. A chip counts down at the bottom.
4. **Next step** twice: the chip is on every step. Tap it: "+1 min" and "Cancel timer".
5. Open <http://127.0.0.1:8081> in another tab. About a minute after the start:
   - the app shows a large "✅ Взбивать · ready!";
   - the page shows «⏰ Взбивать — готово! «Шарлотка (демо)», шаг 1»;
   - its **Открыть шаг** button opens cooking at step 1.
6. Reload the app: "You stopped at step N", **Continue**.
7. **Finish** → "Done!": back to the recipe, or cook it again. "I cooked it" is greyed out (Sprint 5); "My version" is not shown.
8. Also try:
   - offline in the browser's developer tools: a timer with "No connection…", which syncs when you go back online;
   - **＋ → Paste recipe text** (section 5.5): keep or skip the suggested timer, then close and reopen ("Continue checking …");
   - Profile → Design previews → "I cooked it".

## Verification (exact numbers)

- **Locally, Node 24.21.0** (`pnpm verify`):
  - typecheck and lint clean;
  - i18n 4 languages, 397 keys (358 after Sprint 3), 3 plural groups;
  - build and bundle check passed;
  - **tests: 296 recipe-core + 321 API + 160 web + 13 stand-in = 790 passed, 0 failed** (664 after Sprint 3).
- **Clean clone** of the pushed branch at `2b6c1a1`, then `pnpm install --frozen-lockfile` and **Docker Compose** (Postgres **15.19** and SeaweedFS) on spare ports:
  - `pnpm verify` against that database: all 790 passed, including the S3 contract test;
  - `pnpm demo` from the same clone started with the stand-in.
  - In Chromium against it, the demo script above, timed:
    - the timer started at 1:00 and showed 0:59 on step 3;
    - the alarm came at 61.4 s;
    - the message reached the stand-in page at 61.6 s;
    - its link opened step 1;
    - reload offered to continue;
    - the only failed request was telegram.org, which this sandbox blocks.
- **GitHub Actions:** runs #21–#25 green, the last on `2b6c1a1`. They cover the checks and the tests on Postgres 15 and 16 with SeaweedFS. From #24 there is also a new job that builds the production images and checks they start; on GitHub's machines it builds without any extra certificate, as it will on your server.
- **The production stack itself** (`deploy/gcp/compose.yml`, the real images, throwaway random secrets, a local S3 instead of Cloud Storage):
  - migrations ran, and the API passed its production checks;
  - HTTPS through Caddy with the CSP header, `/api/health` ok, and every app address served.
  - The load test, against the production stack: five users, four 12-megapixel photos at once, three imports at once, 200 reads, 10 timers.
  - The second round of the load test hit the API's 60-per-minute limit, as intended.
- **Backups**, against the same stack, with a stand-in for `gcloud`:
  - `backup.sh` made a 141 KB dump;
  - `restore-test.sh` restored it into a temporary database (5 users, 1 book, 8 recipes, 7 migrations, the same as live) and removed it;
  - `restore.sh` brought back a deleted recipe (6 → 8 recipes).
- **Storage check:** the `s3check` image ran the S3 contract test against SeaweedFS with the GCS-style settings (region `auto`, an existing bucket, a prefix): 2/2.
- **Tests that failed on the old code first:**
  - Sprint 4's red commit: the timer API (12), firing (6), the outbox and bot text;
  - later in the sprint: sign-in permission, worker settings, cooking mode (10), timers on screen (8), the deep-link route, the import review (7), the recalculation preview, the "I cooked it" design, the Cloud Storage stand-in, production guards, the image cache, and the stand-in's message links.
  - Each regression test for a bug found this sprint was run against the code before its fix and failed there.

## Memory: is 1 GB enough? (your question)

Measured on the production images and settings, at idle and then under the load above:

| Container   | Idle             | Peak under load (incl. cache) | Limit set |
| ----------- | ---------------- | ----------------------------- | --------- |
| api         | 33 MB            | 232 MB                        | 320 MB    |
| postgres    | 5 MB (+ cache)   | 93 MB                         | 160 MB    |
| worker      | 25 MB            | 32 MB                         | 128 MB    |
| web (Caddy) | 11 MB            | 19 MB                         | 64 MB     |
| **Total**   | **about 110 MB** | **about 380 MB**              |           |

- The API's peak is four full-size phone photos decoded at the same moment. The app normally shrinks photos to 2048 px before upload, so real peaks are lower.
- Building the images on the server is heavier: the largest single build process peaked at about 520 MB.
- Linux, Docker and Google's agents need roughly 250–300 MB more. That is an estimate; I could not measure a real VM.

**Honest answer:** **1 GB (e2-micro) is enough to run the app for a family**, with the 2 GB swap file the guide adds. Builds (first install and each update) will be slow on it, about 15–30 minutes, and will use the swap.

The next size, **e2-small (2 GB)**, costs roughly **6–7 USD a month more in Europe** (about 6.7 → 13.4 USD for the VM). In the US Free Tier regions it is about **12 USD more**, because there the e2-micro is free and the e2-small is not.

Estimated totals per month, including the external IP (about 3.65 USD) and the disk:

| Region                       | e2-micro    | e2-small     |
| ---------------------------- | ----------- | ------------ |
| `us-east1` (Free Tier)       | about 4 USD | about 16 USD |
| Europe (e.g. `europe-west4`) | 11–12 USD   | 18–19 USD    |

These are approximate prices from Google's and third-party pages; the guide asks you to check Google's pricing pages.

My recommendation for the first test: e2-micro in `us-east1`. It fits your credit with room to spare.

## Problems found and fixed this sprint

1. **A stale list erased a just-started timer.** Found when a test failed only under load at the end of the sprint. A list of timers asked for just before a start, but answered after it, overwrote the new timer on the device; the chip vanished until the next refresh. The server timer and its message were never affected. Now such a list is cancelled. A test holds the answer back on purpose, and it fails on the old code.
2. **An offline timer showed 40:01 for a 40:00 timer.** The screen's clock stopped updating while no timer was counting. Found in the browser walkthrough; fixed, with a test.
3. **A timer that fired while the app was closed rang again after a reload.** The device's copy was judged before the server's list arrived. Found in the walkthrough; fixed, with a test.
4. **Cloud Storage compatibility:**
   - the AWS SDK's newer default adds checksum headers that S3-compatible services other than AWS often refuse; it now sends them only where S3 requires them;
   - deletes go one object at a time;
   - a local GCS-like stand-in proves both.
5. **The image library kept a 50 MB cache** that a small server cannot spare. It is now off, at most two threads.
6. **Sticky buttons left a gap.** The Back / Next and Save bars stopped 24 px above the bottom, and text showed through underneath. Visible since the Sprint 3 editor; fixed.
7. **"Not recognized" shown twice** on one imported line; fixed.
8. **Deployment details found while building it here:**
   - Caddy refuses an empty `email` setting (the option was removed);
   - pnpm refuses to prune without a terminal (`CI=true`);
   - a parameter type clash made the timer start fail with a 500 before the first commit of the API;
   - Docker Hub limited anonymous downloads here (Google's mirror was used locally; your server is not affected).
9. **A near miss in my own test, reported for honesty:**
   - During the restore test, the test worker briefly restarted with production settings. With them it would send to `api.telegram.org` (with a random throwaway token).
   - It ran for about 8 seconds. Its queued test messages were not due until four minutes later, so **nothing was sent**. Their attempt counts were unchanged, and its log shows no send.
   - I stopped it, emptied the test queue and removed the test stack.

## Not done, or not verified

- **Real Telegram, phones, Google Cloud:** nothing tried. The guide's checklist covers each item, and the open assumptions are listed in [`docs/ASSUMPTIONS.md`](../ASSUMPTIONS.md):
  - Wake Lock in Telegram's in-app browsers (A-27);
  - bot messages without a `/start` reply (A-28);
  - Cloud Storage with our S3 client (A-25);
  - `gcloud` on the VM (A-26);
  - iPhone photos (A-20, A-24);
  - YouTube inside Telegram (A-22);
  - CSP in Telegram (A-23).
- **The bot does not answer `/start` yet.** There is no webhook; that is Sprint 5. Pressing Start once is still needed so the bot may write.
- **"I cooked it"** exists as a design only. Saving it and the message to the author are Sprint 5 (BE-10 / FE-10).
- **FE-09 "full":** timers on the recipe card outside cooking mode, the "message could not be delivered" state on the chip, and sound.
- **Wake Lock fallback:** the PRD's hidden looping video is not built (D-041). Where Wake Lock is missing, a notice asks to turn off auto-lock.
- **Dragging lines in the import review:** replaced by a "Section" choice, which works with a finger, a mouse and a keyboard (D-043).
- **Automated browser tests in CI:** still manual each sprint; planned for Sprint 5.
- **Prices:** approximate (October 2026), from Google's and third-party pages.
- **Ukrainian and Swedish texts:** about 40 new keys this sprint, not reviewed by native speakers.

## What you need to do yourself

1. **Check CI.** <https://github.com/RocketRn/family-cookbook> → **Actions** → **CI** → the newest run: a green tick means everything passed.
2. **Try the demo.** `git pull`, `pnpm demo:reset` (answer **да**), then `pnpm demo`. Follow sections 5.12 and 5.13 of the Russian guide.
3. **When you are ready for real Telegram:** follow [`docs/DEPLOY-GCP.ru.md`](../DEPLOY-GCP.ru.md) from the top. Set the budget alerts first. Never paste a token or key into a chat, including with me.
4. **After the first test:** send me the checklist results (section 10 of that guide), the CSP log lines if any, and the timer delivery times.
5. **Translations** (as before): `uk.json` and `sv.json` to a native speaker.
6. **Answer the Sprint 5 questions** in the plan.

## По-русски: что сделано и что нужно от вас

**Что появилось.**

- **Режим готовки.**
  - Кнопка «Готовить» открывает список «Всё ли есть?» с галочками.
  - Затем рецепт идёт по шагам: крупный текст, количества пересчитаны, листать можно кнопками или пальцем. Экран не гаснет.
- **Таймеры.**
  - Таймеры идут **на сервере**: когда время выходит, бот присылает сообщение «⏰ … — готово!» с кнопкой «Открыть шаг», даже если приложение закрыто.
  - Без интернета таймер идёт на телефоне и потом передаётся на сервер.
  - Пока всё это видно на странице-имитации <http://127.0.0.1:8081>: в настоящий Telegram ничего не уходит.
- **Проверка вставленного рецепта.** Найденные таймеры и ингредиенты можно оставить или убрать. Исходный текст виден рядом. Начатую проверку можно продолжить позже.
- **Инструкция для настоящего запуска** в Telegram на сервере Google Cloud: [`docs/DEPLOY-GCP.ru.md`](../DEPLOY-GCP.ru.md). Всё по шагам, с ценами, резервными копиями и чек-листом первой проверки.

**Хватит ли 1 ГБ памяти?**

- **Для работы — да.** Я измерил приложение под нагрузкой: около 380 МБ в пике. Нужен файл подкачки, он есть в инструкции.
- **Обновления на таком сервере будут медленными:** 15–30 минут.
- **Сервер побольше (e2-small)** стоит примерно на 6–7 USD в месяц дороже в Европе. В бесплатном регионе США разница около 12 USD.
- **Для первой проверки советую** бесплатный регион `us-east1`: выйдет около 4 USD в месяц.

**Что сделать вам:**

1. Проверьте на GitHub: Actions → CI → зелёная галочка.
2. Посмотрите новое в демо. В папке проекта: `git pull`, затем `pnpm demo:reset` (ответить **да**), затем `pnpm demo`. Дальше разделы 5.12 «Готовка с таймерами» и 5.13 «Сообщения бота» в [`RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md).
3. Когда будете готовы к настоящему Telegram, откройте [`docs/DEPLOY-GCP.ru.md`](../DEPLOY-GCP.ru.md) и идите сверху вниз. **Первым делом — оповещения о расходах.**
4. **Никогда не присылайте мне** (и никому) токен бота, ключи или пароли, в том числе на снимках экрана.
5. После первой проверки пришлите таблицу из раздела 10 инструкции: что работало, что нет, через сколько пришли сообщения таймеров.
6. Ответьте на вопросы плана Sprint 5.
