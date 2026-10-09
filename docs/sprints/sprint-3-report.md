# Sprint 3 report: "Import from text"

Scope: **Part 1 (local demo), CSP Report-Only, BE-06 parser and import with a time limit, BE-11 search, FE-04 editor, the thin paste flow, FE-07 recalculation with the new hint wording, UX-04 cooking-mode designs, QA-01 test plan**. Branch `claude/zen-brown-nifiv3`, last commit before this report `bd8dfd9`.

## In one paragraph

A family member can now paste a recipe copied from a chat or a website. The app splits it into ingredients, steps, timers and a video, and opens it for checking: the lines it was unsure about are highlighted, with the reason in plain words. Recipes can also be written from scratch and edited in a real editor, with photos made smaller on the phone before upload. Typing "сахаром" next to an inserted amount gives "сахаром (1 стакан)", and that amount follows recalculation. On any recipe, "Recalculate" changes the servings, or works out everything from what you have ("I only have 3 eggs"). Search now runs on the server, finds other word forms («яблоки» → «кислых яблок»), and finds tags in any language. Cooking mode exists as designs. Everything was checked from a fresh copy with Docker Compose, in Chromium against the real API, and on GitHub Actions with Postgres 15 and 16. **Nothing has been tried in real Telegram or on a phone yet.**

## What was built

| Commit      | Task                 | What it does                                                                                                                                                                                                                                               |
| ----------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6789457`   | Part 1: local demo   | `pnpm demo` / `demo:stop` / `demo:reset` for Ubuntu, and the Russian step-by-step guide [`docs/RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md).                                                                                                                  |
| `c899e8b`   | CSP (addition)       | Production build sends `Content-Security-Policy-Report-Only` with API, S3, Telegram and YouTube origins from env. `POST /csp-report` logs violations. How to check at the first Telegram test: [`docs/CSP.md`](../CSP.md) (D-032). CI actions moved to v5. |
| `51b1295`   | Parser tests first   | The PRD 5.1.3 table, 10 reference recipes in 4 languages, 32 hostile inputs with a time budget. Committed **red**. The place for real family texts: [`docs/fixtures/README.md`](../fixtures/README.md).                                                    |
| `3392720`   | BE-06                | The parser (`recipe-core/parse`, linear-time patterns only) and `POST /recipes/import`: parsing runs in worker threads with a hard 3 s limit (`IMPORT_TIMEOUT`); 10 imports per minute; the original text is kept (D-033).                                 |
| `318e001`   | BE-11                | Server search over title, ingredients and tags (Postgres full text, GIN index), with prefix matching while typing, stems in ru/en/sv, ё = е, and tag names in all 4 languages. Filters by tag, difficulty and time (D-034).                                |
| `e13815a`   | FE-04                | The recipe editor; card actions Edit / Unpublish / Delete; photo upload with downscaling in the browser (D-035).                                                                                                                                           |
| `41a0b62`   | Paste flow (thin)    | "＋ → Paste recipe text" → "Check the recipe" in the editor with highlighted lines (D-036).                                                                                                                                                                |
| `0a19389`   | FE-07 + hint wording | The recalculation panel; eggs "взбить", other whole items "взять … и использовать" (D-037, PRD 5.3).                                                                                                                                                       |
| `10246b8`   | FE-07 fix            | Timers say "time may differ" after a recalculation; a product in two sections is offered as two lines (PRD 2.3).                                                                                                                                           |
| `bd8dfd9`   | UX-04 + QA-01        | Cooking-mode designs at `/dev/cook` (D-038) and the test plan [`docs/QA.md`](../QA.md).                                                                                                                                                                    |
| this commit | Wrap-up              | This report; the Russian guide updated for the new features.                                                                                                                                                                                               |

## Your decisions, and how they were applied

| #   | Decision                                                       | Done                                                                                                                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Paste flow: thin now, full review in Sprint 4                  | Yes (D-036). Paste → parse → the editor as "Check the recipe": what to check, why, and the original text. Side by side with accept/reject per timer is FE-05 in Sprint 4.                                                                                                                                                                                                 |
| 2   | Hint wording: eggs "взбить", others "взять N и использовать ¾" | Yes (D-037). PRD 5.3 now has a table with the wording in all 4 languages. Formatter tests check eggs and other items in ru, uk, en and sv.                                                                                                                                                                                                                                |
| 3   | Editor inserts "name (amount)"                                 | Yes (D-035). "Insert into the text" adds «сахар ([сахар])». The author changes the word («сахаром»), and a preview line shows «сахаром (1 стакан)».                                                                                                                                                                                                                       |
| +   | CSP Report-Only                                                | Yes (D-032). `report-uri` only: in Chromium `report-to` reports never arrived. Telegram's script and the YouTube player are allowed. Enforcing comes after your first Telegram test.                                                                                                                                                                                      |
| +   | Parser safety                                                  | Yes (D-033). Every pattern is linear-time. 32 hostile 20,000-character texts each finish under the 250 ms budget; the slowest takes about 32 ms. Two old patterns were quadratic and were replaced: `parseAmount` took 459 ms on 20,000 spaces, now about 2 ms. The server stops a parse after 3 s and answers `IMPORT_TIMEOUT`; tested with a deliberately stuck worker. |
| +   | iPhone photos                                                  | Yes (D-035). The picker accepts only JPEG, PNG and WebP. Photos over 2048 px or 3 MB are redrawn at most 2048 px wide, JPEG quality 0.8. In Chromium: 4032 × 3024 → 2048 × 1536, 301 KB. **What an iPhone actually hands over needs a real-device test** (A-24).                                                                                                          |
| +   | Fixtures for real texts                                        | Yes: [`docs/fixtures/README.md`](../fixtures/README.md). No personal data was invented; the 10 reference texts are written for the tests.                                                                                                                                                                                                                                 |

## Demo script: "Import from text"

In the project folder: `git pull`, then `pnpm demo`. The browser opens at <http://localhost:5173/?devUser=1>. The Russian guide has the same steps with screenshots: sections 5.3–5.5 of [`RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md).

1. **Search.** Type `яблоки`: only the apple recipes remain (other word forms are found too). Try a filter. Clear the search.
2. **Paste.** Tap **＋ → Paste recipe text**. Paste the «Сырники» text from section 5.5 of the guide and tap **Parse**.
3. **Check.** "Check the recipe" opens:
   - title, 4 servings, 6 ingredients and 3 steps are filled in;
   - step 3 has a 3-minute timer;
   - «ванилин» is highlighted ("Not recognized"). Set it to "A pinch", and the highlight goes.
4. **Publish.** It appears in the book.
5. **Recalculate.** Open «Шарлотка (демо)» → **Recalculate**:
   - by servings 6 → 12: every amount doubles, also inside step text («яйца (8 шт.)»); the timer says "time may differ";
   - from one product, «Яйца» 3: everything becomes ¾, "≈ 4.5 servings".
     Reload the page: it is still recalculated. "Back to the original" resets it.
6. **Write.** **＋ → Write a recipe**:
   - add «сахар 1 стакан» and a step «Взбейте яйца с »;
   - link «сахар», then "Insert into the text", and change «сахар» to «сахаром»; the preview reads «сахаром (1 стакан)»;
   - add a timer (it takes "5 минут" from the text if you wrote it) and a photo;
   - Publish.
7. **Edit.** On your recipe: Edit, change servings, Save. Edit again, change the title, and press "‹ Back": it asks before leaving.
8. **Cooking-mode designs.** Profile → Design previews → Cooking mode: switch between Preparation, Step, Timers, Done and Problems.

## Verification (exact numbers)

- **Locally, Node 24.21.0** (`pnpm verify`):
  - typecheck 0 errors; lint clean;
  - i18n check passed: 4 languages, 358 keys (216 after Sprint 2), 3 plural groups;
  - build and bundle check passed;
  - tests: **296 recipe-core + 236 API + 132 web = 664 passed, 0 failed** (452 after Sprint 2).
- **Clean clone** of the pushed branch (commit `bd8dfd9`), then `pnpm install --frozen-lockfile` and **`docker compose up`** (Postgres 15.19 + SeaweedFS) on spare ports. Then migrate, seed, and `pnpm verify` against that database: all 664 passed, including the S3 contract test.
  - From the same clone, `pnpm demo` started.
  - In Chromium against it: the guide's search, recalculation and paste steps, and the editor with a photo upload. No page errors; the only failed request was telegram.org, which this sandbox cannot reach.
- **GitHub Actions:** runs #11–#19 all green, covering checks and tests on Postgres 15 and 16 with SeaweedFS. The red test commit `51b1295` was pushed together with its implementation, so CI did not run on it alone.
- **Tests that failed on the old code first:**
  - parser (committed red);
  - search: 11 of 12 red before the migration; the 12th checks that unknown values are refused, which was already true;
  - import endpoint: did not exist;
  - hint wording: red in all 4 languages;
  - "eggplant": red;
  - timer names in one sentence: red;
  - editor, paste and recalculation screens: did not exist.

## Problems found and fixed this sprint

1. **Two slow patterns** in the number parsing would take seconds on hostile input. They were replaced by loops (D-033).
2. **Timer names.** When a sentence ended right after a unit ("…40 минут."), two timers in that sentence were both named after the whole sentence. Found while building the editor's timer suggestion; fixed with a test. It also affected import.
3. **"Eggplant" was an egg.** The product rule matched the word start "egg", so eggplants were rounded as whole pieces. Fixed with a test.
4. **Rounding class lost on edit.** My first version of the editor let the API re-guess each line's rounding class from its name on every save, which could overwrite a deliberate one. Unchanged lines now keep theirs. Found in self-review before pushing.
5. **CSP `report-to`** reports never arrived in Chromium, so only `report-uri` is used (D-032).
6. **The dev editor mock-up** would have been a second, fake editor next to the real one; it was removed.

## Not done, or not verified

- **Real Telegram and phones:** not tried. Each needs a device; they are listed in [`docs/QA.md`](../QA.md) section 5:
  - iPhone photos arriving as JPEG and upright (A-20, A-24);
  - photo links (A-21);
  - YouTube (A-22);
  - CSP in Telegram Web (A-23);
  - the Back question and the closing confirmation in Telegram (D-035).
- **CSP** is report-only. Switching to enforcing waits for your first Telegram test (D-032).
- **Search:**
  - results are newest first, not by relevance (fine for a family book);
  - Ukrainian word forms use the Russian stemmer, which is approximate.
- **Recalculation:** a unit written only as text is not declined ("2 кочан" instead of "2 кочана"); units chosen from the list are.
- **Import review:** the full side-by-side review, accept/reject per timer, and dragging lines between sections are FE-05 (Sprint 4). The editor moves lines with Up / Down for now.
- **Browser tests** are run by hand each sprint; adding them to CI is planned for Sprint 5 (QA-01).
- **Ukrainian and Swedish texts:** not reviewed by native speakers. About 140 new texts this sprint.
- **Cooking mode and timers:** designs only. They are Sprint 4–5 work.

## What you need to do yourself

1. **Check CI.** Open <https://github.com/RocketRn/family-cookbook> → **Actions** → **CI**, and the newest run. A green tick means everything passed.
2. **Try the demo.** In the project folder: `git pull`, then `pnpm demo`. Follow sections 5.3–5.5 of the Russian guide. If something does not start, send me the last 20 lines from the terminal.
3. **Native review of translations** (as before): `uk.json` and `sv.json` → Raw → send the link to a native speaker.
4. **At the first real Telegram test** (when there is a bot and a server): the CSP check in [`docs/CSP.md`](../CSP.md), and one iPhone photo through the editor.
5. **Answer the Sprint 4 questions** in the plan.

## По-русски: что нужно сделать вам

1. **Проверки на GitHub.** Откройте <https://github.com/RocketRn/family-cookbook>, вкладка **Actions**, слева **CI**, затем верхний (самый новый) запуск. Зелёная галочка: всё прошло. В этом спринте все запуски зелёные.
2. **Посмотреть новое в демо.** Откройте терминал (Ctrl + Alt + T), перейдите в папку проекта (`cd ~/family-cookbook`) и выполните:

   ```bash
   git pull
   pnpm demo
   ```

   Браузер откроется сам. Дальше по инструкции [`docs/RUN-LOCALLY.ru.md`](../RUN-LOCALLY.ru.md), разделы:
   - **5.3**: пересчёт порций и «от продукта» (например, «у меня только 3 яйца»);
   - **5.4**: написать свой рецепт, вставить количество в текст шага («сахаром (1 стакан)»), добавить фото;
   - **5.5**: вставить текст рецепта целиком: программа сама разложит его по полям и выделит жёлтым сомнительные строки.

   Если что-то не запустилось, пришлите последние 20 строк из терминала.

3. **Проверка переводов** (как раньше): на GitHub откройте `apps/web/src/i18n/locales/uk.json` и `sv.json`, нажмите **Raw** и отправьте ссылку носителю языка. Проверять нужно только текст справа от `:`.
4. **При первой проверке в настоящем Telegram** (когда будут бот и сервер):
   - проверить отчёты CSP по инструкции [`docs/CSP.md`](../CSP.md) (там есть раздел по-русски);
   - загрузить одно фото с iPhone через редактор.
5. **Ответить на вопросы** в плане Sprint 4.
