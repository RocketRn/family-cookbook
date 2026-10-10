# Sprint 6 report: "Ready for the family"

Branch `claude/zen-brown-nifiv3`. Sprint 6 is the last sprint of the PRD's first stage. This file was updated after every task; the plan as approved and each task's notes are in the appendices.

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
| S6-6  | Polish: first-run hints, error and offline states, haptics, long texts     | done (found and fixed 5 layout problems and 2 offline ones)              | `80d082e` |
| S6-7  | Small Sprint 5 findings: Saved filters, timer's recipe name, hint language | done                                                                     | `b2e251d` |
| S6-8  | Usage counts                                                               | **not built** (owner's answer 3)                                         |           |
| S6-9  | CSP decision                                                               | placeholder: after the first Telegram test's reports                     |           |
| S6-10 | Wrap-up: clean clone, CI, guides, report, "before you invite the family"   | done                                                                     | (this)    |

## In one paragraph

The app is ready for the family's beta, apart from the first Telegram test, which is yours:

- **Forward a recipe to the bot.** Any recipe text forwarded (or typed) to the bot becomes your private draft, read by the same parser as "Paste"; the bot answers with "Check the recipe". Treated as untrusted input: text only, at most 4096 characters, 30 an hour, only for people who already opened the app. The webhook's secret check is now proven by tests.
- **Share a recipe into a chat.** "Share" sends a message with the recipe's photo, title and an "Open the recipe" button. Someone outside the book who opens a "by link" recipe can read, recalculate and cook it with timers, but not save it or react.
- **Is it working?** A page (`/api/health/full`) shows how late timer messages are and whether the worker keeps up; Google's free uptime check e-mails you when it stops.
- **Load:** 1000 running timers, 100 ending in the same second: every message once. It found that the burst was slow (the last message 18.5 s late); fixed, now about 4.5 s, within Telegram's own limit.
- **Polish:** a note when there is no connection (screens no longer say "Recipe not found" offline), the same buzzes everywhere, three first-run tips, and a browser test at 320 px in Ukrainian, Swedish and Russian that found and fixed five layout problems.
- **Small things from Sprint 5:** the hint's unit word follows the recipe's language (your answer 4), another recipe's timer names its recipe, and the "Saved" tab has filters.

## What was built

| Area              | What                                                                                                                                                                         | Where it is described                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Bot               | A forwarded or typed recipe → a private draft and an answer with "Check the recipe"; refusals for photos, long texts, strangers, too many; the same text twice is one draft  | D-054; RUN-LOCALLY 5.13; DEPLOY-GCP 10      |
| Bot               | Webhook secret: every call checked, refused without it, nothing stored, no secret or token in any log (tests)                                                                | D-047, S6-2 notes                           |
| Sharing           | "Share" → `savePreparedInlineMessage` + Telegram's `shareMessage`, with the link as a fallback; the guest screen for `r_<token>` links                                       | D-055, D-056; RUN-LOCALLY 5.16              |
| Health            | The worker logs each timer message's delay; `/api/health/full` (503 when something is wrong); Google uptime check guide                                                      | D-057; DEPLOY-GCP 9.10, 13                  |
| Load              | `worker-load.test.ts` in CI; the sender waits out short bot-wide waits and takes batch after batch                                                                           | D-058; QA.md                                |
| Polish            | Offline note and "waiting" state; one buzz rule; three tips; the 320 px browser test; five layout fixes                                                                      | D-059; RUN-LOCALLY 5.17                     |
| Sprint 5 findings | Hint unit language; another recipe's timer names its recipe; "Saved" filters                                                                                                 | D-060; PRD 5.3; RUN-LOCALLY 5.3, 5.10, 5.12 |
| Guides            | DEPLOY-GCP: phone checks for this sprint (section 10), **section 14 "Перед тем как пригласить семью"**; a table in section 13 fixed (three rows had lost their "what to do") | DEPLOY-GCP                                  |

## Your answers and additions, and how they were applied

1. **Forwarded photos ignored, text only:** a photo, file or sticker gets "I can only read text"; a photo's caption is not read either.
2. **A guest may read, recalculate and cook with timers; no saving, no reactions:** enforced by the server too (reactions no longer accept the link's token), so the rule holds even outside the app.
3. **Usage counts skipped:** S6-8 not built. Nothing is counted about people.
4. **Hint language:** hints in the reader's language, the unit word in the line's language. A test checks all 16 combinations of recipe and reader language (D-060).
5. **No grammY:** kept plain HTTP; the reasons are in D-053.

- **Webhook security:** already built in Sprint 5; tests now prove each part (S6-2 notes).
- **Forwarded text as untrusted input:** all six rules (length, per-person limit, the same parser and time limit, text only, known people only, private draft) have tests.
- **S6-1 and S6-9** stay placeholders for your first Telegram test.

## Demo script: "Ready for the family"

`pnpm demo:stop`, `git pull`, `pnpm demo`. The bot's page: <http://127.0.0.1:8081>. The same steps in Russian are in the Russian section below.

1. **Forward a recipe.** On the bot's page, "Переслать боту" as Dev Keeper (100000001): paste any recipe text, send. Within about 2 s: "📝 Сохранил рецепт … в ваши черновики" with **Проверить рецепт**; its button opens the review with the original text. Publish it.
2. **Share and the guest.** As user 1 open "Шарлотка (демо)" → **Поделиться** → **Отправить в чат**. On the bot's page, "Поделились рецептом": **Открыть рецепт** opens it as user 3 (Swedish, not in the book): "shared with you by link", Recalculate and Cook work, a timer brings the bot's message; no Save, no reactions.
3. **Tips.** In a private window: one 💡 tip on the book, on the card, and in cooking; "Понятно" hides it for good.
4. **No connection.** DevTools → Network → **Offline**: the note at the top; a recipe opened before is readable, one not opened says it will load when the connection is back, and loads when you choose **No throttling**.
5. **Another recipe's timer.** Start the 1-minute timer on "Шарлотка (демо)", open another recipe: the panel shows "⏱ Взбивать · 0:50 · Шарлотка (демо)".
6. **Hint language.** As user 2 (English): "Шарлотка (демо)" → Recalculate → 4 servings: the eggs show "3 шт. (or 2 шт. and ⅔ of one more)", no "pcs".
7. **"Saved" filters.** As user 2: save a recipe, then **Saved** → **Filters**.
8. **Health.** <http://localhost:5173/api/health/full>: `"status":"ok"` and the last hour's timer messages.

## Verification (exact numbers)

- **Clean clone** of the pushed branch at `b2e251d`, `pnpm install --frozen-lockfile`, **Docker Compose** (Postgres **15.19** and SeaweedFS) on spare ports, no `.env`:
  - `pnpm verify` against that database: **1094 passed** (stand-in 33, recipe engine 298, API 540 with the S3 contract and the load test, web 223). Sprint 5 ended with 983;
  - from the same clone, `pnpm demo:reset`, then `pnpm demo`: ready in **14 s** on the default web, API and bot ports;
  - `pnpm e2e` against it: **22 of 22 passed** in 92 s (15 at the end of Sprint 5). That covers this report's demo script except steps 3 and 4 in a real browser (covered by web tests) and step 8 (checked by hand: `"status":"ok"`, 3 timer messages, p50 453 ms, max 1025 ms).
- **GitHub Actions:** runs **#39–#46**, one per push, **all green**, five jobs each (checks, tests on Postgres 15 and 16, production images, browser tests). The load test runs in both Postgres jobs.
- **Load (QA-03)** on this computer: the last of 100 messages **4.4–4.7 s** late (eight runs, including the clean clone), half within 2.4–2.6 s, none over 5 s, no 429. Before the fix: 18.5 s, 8.8 s, 73 over 5 s.
- **Tests that failed on the old code first** (numbers in each task's notes): forward 22 of 30 API + 3 web + 2 stand-in; guest 6 + 6; share 6 API + 6 stand-in + 5 web; health 8 of 8; load (18.5 s) and 3 of 4 sender tests; offline 4, buzz 5, tips 3, timer label, button names; hint 2 + web; other recipe's timer; Saved filters 2 web. The 320 px test failed first on real problems (below). Tests that passed at once are guards and are named as such in the notes.

## Problems found and fixed this sprint

1. **A burst of timer messages was slow** (the load test). Every message went once, but the last of 100 was 18.5 s late: the sender put a message off until the next poll whenever the bot-wide pace had just been used. Now about 4.5 s (D-058).
2. **Offline, screens lied** (found while reviewing). A screen not loaded before showed "Recipe not found" or "No recipes yet", and a tap waited silently. Now "it will load when the connection is back", and a tap says "No connection" at once (D-059).
3. **Five layout problems at 320 px** (the new browser test): the editor's unit chip cut "ingen enhet" (sv); a step's timer on a recalculated card (sv) and a long timer label in cooking mode made the screen scroll sideways; a title with one long word did the same; "Stop cooking" and "Finish" were both "Завершити" (uk).
4. **The 320 px check itself first found nothing** because of a mistake in it (every element looked like part of a sideways-scrolling area). Caught by its self-check, which plants a broken button; fixed before it counted.
5. **The deploy guide's troubleshooting table** (found while writing section 14): three rows added this sprint had three cells in a two-column table, so GitHub hid their "what to do". Fixed; a scan of all docs finds no other such table.

## Not done, or not verified

- **Real Telegram, phones, Google Cloud:** nothing tried by me. Open assumptions in [`docs/ASSUMPTIONS.md`](../ASSUMPTIONS.md), each with a line in the checklist (DEPLOY-GCP 10). New this sprint: how the shared message looks on each phone (A-29), the buzzes (A-30), the offline note in airplane mode (A-31), the narrowest phone.
- **S6-1** (fixes from your first Telegram test) and **S6-9** (the CSP decision): placeholders, waiting for your findings.
- **S6-8** usage counts: not built (your answer 3).
- **The load test ran the real worker code on this computer's Postgres**, not the production Docker images: a production worker refuses the stand-in by design (Sprint 5 safety guard), so it cannot be load-tested without real Telegram.
- **UX-07** usability test with 3–5 people in a kitchen (PRD 6.4): needs people; it becomes the family beta.
- **Ukrainian and Swedish texts:** 15 new keys this sprint (429 in all), not reviewed by native speakers.
- **"✏️ My version"** stays hidden (your Sprint 4 answer).

## What you need to do yourself

1. **Check CI:** Actions → CI → the newest run: five green jobs.
2. **Try the demo:** `pnpm demo:stop`, `git pull`, `pnpm demo`, then the demo script.
3. **Update the server** if you set it up (DEPLOY-GCP 12): one command; migrations run by themselves; then everyone opens the app once before forwarding recipes.
4. **The first Telegram test:** DEPLOY-GCP from the top, then section 10's checklist (now with this sprint's checks). Send me the table; it becomes S6-1 and S6-9. Never paste a token or key into a chat.
5. **Before inviting the family:** DEPLOY-GCP section 14 (also below in Russian).
6. **Translations:** `uk.json` and `sv.json` to a native speaker.

## По-русски: что сделано и что нужно от вас

**Что появилось.**

- **Рецепт можно переслать боту.** Перешлите боту сообщение с рецептом из любого чата (или напишите текст сами). Бот прочитает его так же, как «Вставить текст», сохранит как ваш личный черновик и ответит кнопкой «Проверить рецепт». Другие люди черновик не видят. Защита: только текст, не длиннее 4096 знаков, не больше 30 в час, и только от тех, кто уже открывал приложение. Что бот принимает только настоящие запросы Telegram (секретный заголовок), теперь доказано тестами.
- **«Поделиться».** Кнопка в карточке отправляет в чат Telegram сообщение с фото, названием и кнопкой «Открыть рецепт». Если рецепт «по ссылке», его может открыть и человек не из книги: читать, пересчитывать и готовить с таймерами, но не сохранять и не ставить реакции (ваш ответ 2).
- **Работает ли сервер.** Страница `/api/health/full` показывает, с каким опозданием приходят сообщения таймеров и не застрял ли фоновый процесс. Бесплатная проверка Google пришлёт вам письмо, если что-то сломалось (DEPLOY-GCP, раздел 9.10).
- **Нагрузка.** Проверка: 1000 таймеров у 100 человек, 100 из них заканчиваются в одну секунду. Каждое сообщение пришло ровно один раз. Нашлась проблема: последнее сообщение опаздывало на 18,5 секунды. Исправлено: теперь около 4,5 секунды (быстрее Telegram не разрешает отправлять 100 сообщений).
- **Доводка.** Без связи наверху появляется полоска «Нет связи…», а не «Рецепт не найден». Телефон одинаково вибрирует при выборе, успехе и ошибке. Три подсказки при первом запуске. Новая автоматическая проверка открывает все экраны на самом узком телефоне на украинском, шведском и русском: нашла и исправила пять мест, где текст обрезался или страница ездила вбок.
- **Мелочи из Sprint 5.** Единица в подсказке пересчёта — на языке рецепта: «1 шт. (or whisk 2 шт. and take ⅔)», без смешения «pcs» и «шт.» (ваш ответ 4). Таймер другого рецепта в карточке подписан названием своего рецепта. На вкладке «Сохранённое» есть фильтры.

**Ничего не запущено на сервере и не проверено в настоящем Telegram или на телефоне.** Все сообщения бота уходили только на страницу-имитацию.

**Сценарий показа.** В папке проекта: `pnpm demo:stop`, `git pull`, затем `pnpm demo`. Подробно: [`RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md), разделы 5.13, 5.16, 5.17.

1. **Переслать рецепт.** Откройте страницу бота <http://127.0.0.1:8081>. В форме «Переслать боту» выберите Dev Keeper (100000001), вставьте любой текст рецепта и нажмите **«Переслать боту»**. Через пару секунд придёт «📝 Сохранил рецепт … в ваши черновики» с кнопкой **«Проверить рецепт»**. Кнопка откроет экран проверки с исходным текстом. Опубликуйте рецепт.
2. **Поделиться и гость.** Откройте <http://localhost:5173/?devUser=1>, рецепт «Шарлотка (демо)» → **«Поделиться»** → **«Отправить в чат»**. На странице бота появится блок **«Поделились рецептом»**. Его кнопка **«Открыть рецепт»** открывает рецепт как пользователь 3 (шведский интерфейс, не в книге): пересчитать и готовить можно, таймер присылает сообщение, а «Сохранить» и реакций нет.
3. **Подсказки.** Откройте приложение в окне инкогнито: на книге, в карточке и в готовке по одной подсказке 💡. «Понятно» убирает её навсегда.
4. **Без связи.** F12 → вкладка **Network** → **Offline**: наверху полоска «Нет связи…». Рецепт, который уже открывали, виден; который не открывали — «Загрузится, когда связь вернётся», и загрузится сам, когда вы выберете **No throttling**.
5. **Таймер другого рецепта.** В «Шарлотке (демо)» запустите минутный таймер «⏱ Взбивать», потом откройте другой рецепт: внизу «⏱ Взбивать · 0:50 · Шарлотка (демо)».
6. **Язык подсказки.** Как пользователь 2 (английский интерфейс, <http://localhost:5173/?devUser=2>): «Шарлотка (демо)» → **Recalculate** → 4 порции. У яиц: «3 шт. (or 2 шт. and ⅔ of one more)» — без «pcs».
7. **Фильтры «Сохранённого».** Как пользователь 2 сохраните рецепт кнопкой 🔖, откройте вкладку **Saved** → **Filters**.
8. **Состояние сервера.** <http://localhost:5173/api/health/full>: `"status":"ok"` и сообщения таймеров за последний час.

**Перед тем как пригласить семью** (этот же список — в [`DEPLOY-GCP.ru.md`](../DEPLOY-GCP.ru.md), раздел 14):

Сервер и данные:

- [ ] На GitHub у последнего запуска CI зелёная галочка, сервер обновлён до этой версии (DEPLOY-GCP, раздел 12).
- [ ] Первая проверка в Telegram (раздел 10) пройдена, таблица у меня, найденное исправлено.
- [ ] Ночные копии делаются, проверка восстановления пройдена хотя бы раз (раздел 11).
- [ ] Письмо при сбое настроено, тестовое письмо пришло (раздел 9.10).
- [ ] Оповещения о расходах включены (раздел 2).
- [ ] `https://<ваш DOMAIN>/api/health/full` показывает `"status":"ok"`.

Секреты:

- [ ] Токен бота, ключи и `.env` есть только на сервере и в менеджере паролей, их не было в чатах и на снимках экрана. Если сомневаетесь — замените токен (`/revoke` в BotFather) и ключ хранилища.
- [ ] `TELEGRAM_LIVE=yes` записан в `.env` вручную, только на сервере.

Бот и книга:

- [ ] В BotFather у бота и Mini App понятные имя, описание и картинка (раздел 8).
- [ ] Книга создана, у неё понятное название, внесены 3–5 любимых рецептов.
- [ ] Приглашение (Профиль → «Приглашение» → «Отправить приглашение») — только в семейный чат. Если ссылка попала не туда: «Выпустить новый код».

Что сказать семье (можно переслать):

> Это наша книга рецептов в Telegram. Откройте ссылку и нажмите «Start» у бота — иначе таймеры не смогут прислать сообщение. Если приложение спросит, можно ли боту писать вам, разрешите.
> Таймер в рецепте присылает сообщение от бота, даже если Telegram закрыт.
> Рецепт из любого чата можно переслать боту — он станет вашим черновиком.
> Кнопка «Пересчитать» меняет количества под нужное число порций или под то, что есть дома.

Через неделю:

- [ ] На странице `/api/health/full` опоздавших сообщений (`late`) нет или почти нет.
- [ ] Пришлите мне строки CSP, если они есть (раздел 10), и вывод памяти и диска, если диск заполнен больше чем на 80 % (раздел 13).
- [ ] Спросите семью, что было неудобно, и пришлите мне.

**Что сделать вам:**

1. Проверьте на GitHub: Actions → CI → у последнего запуска зелёная галочка (пять заданий).
2. Посмотрите новое в демо по сценарию выше.
3. Если сервер уже настроен: обновите его одной командой (DEPLOY-GCP, раздел 12). Изменения базы применяются сами. После обновления каждый один раз открывает приложение, прежде чем пересылать рецепты боту.
4. Пройдите первую проверку в Telegram (раздел 10, там появились пункты этого спринта) и пришлите мне таблицу. **Никогда не присылайте токен бота, ключи и пароли**, даже на снимках экрана.
5. Перед приглашением семьи — список выше (раздел 14).
6. Отдайте `uk.json` и `sv.json` носителям языка (15 новых строк).

## What remains after Sprint 6

Sprint 6 was the last sprint of the PRD's stage 1 (the MVP, PRD 1.4 and 6). Every stage-1 feature is built and tested on this computer; what remains is checking it in the real world, and stage 2.

**Stage 1: what is left (mostly yours, then small fixes by me)**

| Item                                                                                                                  | State                                | Who                 |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------- |
| Deploy to Google Cloud and the first Telegram test on phones (QA-02)                                                  | Guide ready (DEPLOY-GCP 1–10)        | You, then me (S6-1) |
| Fixes from that test (S6-1) and the CSP decision: block or keep "report only" (S6-9)                                  | Waiting for your findings            | Me                  |
| Open device questions: iPhone photos (A-24), the shared message's look (A-29), sound, buzzes, YouTube inside Telegram | In the checklist (DEPLOY-GCP 10)     | You                 |
| Usability test in a kitchen (UX-07): becomes the family beta                                                          | Section 14 says what to ask          | You and the family  |
| Native review of Ukrainian and Swedish texts (429 keys)                                                               | Not done                             | A native speaker    |
| Not built by your decisions: usage counts (S6-8), forwarded photos (text only), "✏️ My version" as a reaction         | Recorded in the report and DECISIONS | —                   |

**Stage 2 (PRD 1.4), not started; the data model already has room for it**

- A reference of measures and densities, and conversion between units (cups ↔ grams; Swedish dl, msk, tsk, krm).
- Recalculation from several products, with "what is missing".
- "My version" as a copy of a recipe (reactions already have `version_recipe_id`; the recipe's `origin_recipe_id` is added then, D-004).
- Several books per person (the one-book rule is a single database constraint to drop).
- Gamification.

Later stages (PRD 1.4): OCR of page photos, a shopping list, "what to cook from what I have", equipment notes (stage 3); a public catalog, nutrition, a menu planner (stage 4).

## Appendix: the plan as approved

### The owner's answers (Sprint 6 approval)

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

### Working rules (unchanged)

- Tests first, failing on the old code; the report records which tests were red first. Each task's tests and code go into one commit, pushed after `pnpm verify`.
- CI green on Postgres 15 and 16, with the browser tests. A clean-clone check with Docker Compose at the end.
- `docs/RUN-LOCALLY.ru.md` and `docs/DEPLOY-GCP.ru.md` updated for anything that changes.
- The Sprint 6 report: a Russian section, a demo script and a "before you invite the family" checklist.
- No real Telegram calls from the sandbox, no real tokens, no deployments. Push the branch, never `main`.

## Appendix: task notes, written after each task

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

### S6-7 Small things found in Sprint 5

- **The unit word inside a hint** (owner's answer 4): hints stay in the reader's language, their unit word follows the ingredient line, so an English reader of a Russian recipe sees "1 шт. (or whisk 2 шт. and take ⅔)", never "2 pcs" next to "1 шт.". A test checks every recipe language against every reader language. Two older tests expected the mixing and now expect the rule (D-060; PRD 5.3 has the rule).
- **Another recipe's timer** on a card (and in cooking mode) names its recipe: "⏱ Духовка · 12:40 · Шарлотка".
- **Filters on the "Saved" tab**: the book's sheet (now one component for both), with the shelf's own choice.
- Red first: the 2 hint tests, the timer test and 2 of 2 Saved web tests failed on the old code. The API test for filtered saved lists passed at once: the server already did it; the test now guards it. The 320 px test covers the Saved tab's filters too. RUN-LOCALLY 5.3, 5.10, 5.12.

### S6-10 Wrap-up

- Clean clone of `b2e251d` with Docker Compose on spare ports: `pnpm verify` 1094 passed; the demo from it ready in 14 s; 22 of 22 browser tests against it. CI #39–#46 green.
- DEPLOY-GCP: this sprint's phone checks in section 10 (tips, buzzes, airplane mode, the narrowest phone); new section 14 "Перед тем как пригласить семью"; section 13's table fixed (three rows added this sprint had a third cell that GitHub hid). A scan of all docs finds no other mismatched table.
- ASSUMPTIONS A-30 (buzzes are felt) and A-31 (the phone's in-app browser reports going offline), both in the checklist.
- This report: the summary, demo script, verification, problems, what is left, the Russian section with the demo script and the family checklist, and what remains after Sprint 6 (PRD stage 1 vs stage 2).
