# Sprint 2 report: "A recipe in the book"

Scope: **Node 24, FE-06, BE-04, BE-05 (with rate limits and HEIC handling), FE-03, UX-03, PATCH /me**. Branch `claude/zen-brown-nifiv3`, last commit before this report `952ccb7`.

## In one paragraph

A family member can now publish a full recipe to the book: a cover photo, ingredients in sections, steps with photos, timers and a YouTube video at the right second, tags, and notes. Everyone in the book sees it in the list and opens a proper recipe card. Amounts are formatted by the new recalculation engine. The Saved tab no longer shows fake recipes in production. The language picked in Profile is saved to the profile. The designs for the recipe editor and the import review exist as working screens in the development build. Everything was checked from a fresh copy of the repository with Docker Compose, and on GitHub Actions with Postgres 15 and 16. **Nothing has been tried in real Telegram or on a phone yet.**

## What was built

| Commit    | Task                       | What it does                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `b5f3d7b` | Node 24 (decision 2)       | First commit of the sprint: `.nvmrc` 24, `engines`, CI reads `.nvmrc`. There is no application Dockerfile yet (Compose runs only Postgres and S3). CI run #4 green.                                                                                                                                                                                                                              |
| `6e3cbbb` | FE-06 tests first          | Golden tables (PRD 5.4) and property tests (fast-check, test-only), committed **red** before the engine existed.                                                                                                                                                                                                                                                                                 |
| `f4474da` | FE-06                      | `packages/recipe-core`: recalculation, smart rounding (PRD 5.3), unit list, number parsing, YouTube links. The engine returns structured quantities only; a separate formatter writes them in the recipe's language. No float `===` anywhere (D-020, D-021).                                                                                                                                     |
| `4494a57` | BE-04 + PATCH /me          | Recipe create / read / edit / delete, lists in pages of 50, share links (128 random bits, revoked when the recipe leaves "by link"), keeper unpublish, publish rules, PRD 7.1 limits, row-level security on every new table. `PATCH /me` saves the language (D-022 … D-025).                                                                                                                     |
| `717cbb1` | fix                        | The production build of recipe-core was broken (CI runs #5 and #6 failed at **Build**; tests were green). Fixed, and typecheck now catches this kind of error too. `pnpm verify` runs exactly what CI runs.                                                                                                                                                                                      |
| `958f5b3` | BE-05 + rate limits + HEIC | Photo upload (type checked from the file bytes, ≤ 10 MB, EXIF/GPS removed, 2048 px + 512 px), S3 storage through the S3 API only, links signed for an hour, unused photos removed by the worker after 24 h. Rate limits per minute: 60 per user (PRD 7.1), 300 per IP, 10 uploads per user, 20 failed sign-ins per IP. HEIC gets a clear translated message, never an error 500 (D-026 … D-028). |
| `80f8abf` | FE-03                      | The real recipe card and API-backed lists with "Load more" and search over loaded pages (decision 6). The Saved tab shows a neutral empty state in production and a marked sample only in development (decision 5). Language changes are sent to `PATCH /me`. Demo script `scripts/demo-recipe.mjs` (D-029, D-030).                                                                              |
| `952ccb7` | UX-03                      | Recipe editor and import review designs as working screens, development build only (D-031).                                                                                                                                                                                                                                                                                                      |

## Your decisions, and how they were applied

| #   | Decision                                 | Done                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SeaweedFS, pinned by digest, S3 API, env | Yes (D-026). The contract test runs against it locally and in CI. It also found a real setup bug: SeaweedFS allowed only one bucket by default, so photos and tests fought over space. Fixed with `-volume.max=100`.                                            |
| 2   | Node 24 first, sharp prebuilt            | Yes. CI prints on every run: `node v24.21.0, sharp 0.35.4, prebuilt @img/sharp-linux-x64@0.35.4, libvips 8.18.6, HEIF input: .avif only`.                                                                                                                       |
| 3   | fast-check in tests only                 | Yes, a devDependency of `recipe-core`.                                                                                                                                                                                                                          |
| 4   | One unit list                            | Yes. `UNITS` in recipe-core is the only list; `pnpm db:migrate` writes the table from it, and a test fails if they ever differ (D-021).                                                                                                                         |
| 5   | Saved: no fake data outside dev          | Yes. Production: "Nothing saved yet". The development sample is marked, and the CI bundle check fails if it reaches production (checked by removing the guard on purpose: the check failed).                                                                    |
| 6   | Client search, pages of 50               | Yes. When more pages exist, the screen says the search covers only the loaded recipes.                                                                                                                                                                          |
| 7   | Share token in BE-04                     | Yes (D-023): 128 bits, revoked when visibility leaves "by link", a new token when shared again, and a database rule makes a token without "by link" impossible.                                                                                                 |
| 8   | PATCH /me                                | Yes, validated against the 4 languages.                                                                                                                                                                                                                         |
| 9   | "New recipe" notification later          | Not built (BE-08, Sprint 4).                                                                                                                                                                                                                                    |
| +   | Rate limits                              | Yes, with 5 tests (D-027). Found by the tests: the plugin's own hook silently skips a second limit on the same request, so the limits are built from the plugin's counters instead.                                                                             |
| +   | HEIC                                     | Our sharp cannot read iPhone HEIC. Such a photo gets 415 `HEIC_NOT_SUPPORTED`, shown in all 4 languages as "HEIC photos are not supported yet. Please choose a JPEG, PNG or WebP photo." **What a real iPhone sends from Telegram needs a device test** (A-20). |

## Demo script: "A recipe in the book"

You need Docker Desktop and Node 24 (see README). In a terminal, in the project folder:

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

In a second terminal:

```bash
node scripts/demo-recipe.mjs
```

It signs in as the seeded keeper (fake development sign-in, no real bot), uploads two photos and publishes "Шарлотка (демо)" to the family book. Then:

1. Open <http://localhost:5173>. The book "Семья" lists the new recipe with its photo, next to the seeded ones.
2. Type `яблок` in the search field: only recipes with apples remain. Clear it.
3. Tap **Шарлотка (демо)**. You see the photo gallery (swipe sideways), the tags, and the ingredients under "Для теста" and "Для начинки", written the Russian way ("4 шт.", "1 стакан", "по вкусу").
4. Scroll to the steps. Step 1 has its own photo, and the amounts sit inside the text ("яйца (**4 шт.**)"). Step 2 has a video box: tap ▶ and the YouTube player starts at 0:30, or tap "Открыть в YouTube". Step 3 shows a timer chip "Духовка · 40 мин".
5. At the bottom: the author's notes and the reactions block (greyed out; reactions arrive in Sprint 5).
6. Open the recipe **Голубцы** (the PRD 5.4 example). The card looks the same, made from the seed data.
7. Profile → pick **English**. The interface switches, and the choice is saved to the profile. Recipe texts and their numbers stay in Russian, by design.
8. Saved tab: in this development build you see a sample marked "Development sample". A production build shows an empty shelf.
9. Profile → **Design previews** opens the editor and import review designs (development only).

What it looked like here (Chromium, phone size 390 × 844): photos loaded from the local S3 through signed links, at the right resolution. The YouTube player got the correct start second. The only failed requests were to telegram.org and youtube.com, which this sandbox cannot reach.

## Verification (exact numbers)

- **Locally, Node 24.21.0** (`pnpm verify`): typecheck 0 errors; lint clean; i18n check passed (4 languages, 216 keys, 3 plural groups); build passed; bundle check passed; tests **166 recipe-core + 211 API + 75 web = 452 passed, 0 failed**. Sprint 1 ended with 177.
- **Clean clone** of the pushed branch (commit `952ccb7`), `pnpm install --frozen-lockfile`, then **`docker compose up`** (Postgres 15.19 + SeaweedFS 4.48), migrate, seed, and the same `pnpm verify` against it: all 452 passed, including the S3 contract test. From the same clone, the API, web app, worker and demo script ran, and the card was checked in Chromium.
- **GitHub Actions:** run #4 (Node 24) green. Runs **#5 and #6 failed at the Build step** (recipe-core build; the tests were green) and were fixed in `717cbb1`. Runs #7, #8 and #9 are green: checks (now including the sharp check), and tests on Postgres 15 and 16 with SeaweedFS started in CI.
- **Tests written to fail on the old code:**
  - FE-06: committed red before the engine.
  - BE-04: row-level security tests were mutation-checked (weakening one policy made 3 tests fail).
  - Saved: the production-mode test fails on Sprint 1's mock shelf.
  - Placeholders and HTML: there is a test with `<b>` in a step text.
  - Rate limits: the upload-limit test failed with the plugin's own hooks. That is how the skipped-limit problem was found.
  - S3: the contract test failed with SeaweedFS's default settings. That is how the bucket problem was found.

## Problems found and fixed this sprint

1. **The recipe-core production build was broken** for two pushes (CI #5, #6). Cause: a type only available in tests. Fixed. `pnpm verify` now mirrors CI, so this is checked before every push.
2. **Rate-limit plugin**: two limits on one request meant the second one never ran. Fixed (D-027).
3. **SeaweedFS** allowed only one bucket by default. The second bucket got "no space" (InternalError). Fixed in Compose and CI (D-026).
4. **Soft delete** was refused by row-level security, because the deleted recipe becomes invisible even to its author. It is now a narrow database function (D-025).
5. **Step-text placeholders** first showed the ingredient name. PRD 2.3 says they stand for the amount. Fixed (D-029).
6. **Photo sizes**: the card told the browser the wrong image widths. Fixed after measuring in Chromium.

## Not done, or not verified

- **Real Telegram and phones:** not tried. Each of these needs a device:
  - HEIC from an iPhone (A-20);
  - our signed photo links inside Telegram (A-21);
  - the YouTube player inside Telegram (A-22).
- **Telegram documentation:** this agent still cannot open `core.telegram.org`.
- **Ukrainian and Swedish texts:** not reviewed by native speakers. This sprint added about 110 new texts.
- **Production:**
  - The content-security policy (PRD 7.1) is not set yet. It depends on the final hosting addresses; it is proposed for Sprint 3.
  - Rate limits count per API process. One instance is fine for the MVP; several would need Redis.
- **GitHub Actions** warns that `actions/checkout@v4` / `setup-node@v4` still target Node 20. GitHub forces them to Node 24 for now, so nothing fails. The bump is planned for Sprint 3.
- **Two wording issues found in the demo** (questions for you in the Sprint 3 plan):
  - The PRD hint "whisk N and take ¾" only makes sense for eggs.
  - In Russian and Ukrainian, an amount dropped into a sentence cannot follow grammatical case: "с **1 стакан** сахара" is wrong. Writing "сахаром (1 стакан)" reads fine.

## What you need to do yourself

1. **Look at the checks on GitHub.** Open <https://github.com/RocketRn/family-cookbook> → **Actions** tab → **CI** on the left → the newest run. A green tick means everything passed. Runs #5 and #6 are red; they were fixed by the next commit (see above).
2. **Try the demo** (optional; needs Docker Desktop and Node 24): follow "Demo script" above. If something does not start, send me the last 20 lines from the terminal.
3. **Native review of translations.** On GitHub open `apps/web/src/i18n/locales/uk.json` and `sv.json`, click **Raw**, and send the link to a native speaker. Ask them to check only the text on the right of each `:`.
4. **Answer the Sprint 3 questions** in the plan (three short ones).
5. Not yet: the bot token. Sprint 3 does not need a bot. When we need it, I will ask only for the bot's **username**, never the token.

## По-русски: что нужно сделать вам

1. **Проверки на GitHub.** Откройте <https://github.com/RocketRn/family-cookbook>, вкладка **Actions**, слева **CI**, затем верхний (самый новый) запуск. Зелёная галочка: всё прошло. Запуски №5 и №6 красные: ошибку исправил следующий коммит (см. выше).
2. **Посмотреть демо** (по желанию; нужны Docker Desktop и Node 24). В папке проекта выполните команды из раздела "Demo script", затем во втором окне терминала `node scripts/demo-recipe.mjs`. Откройте <http://localhost:5173>: в книге «Семья» появится «Шарлотка (демо)» с фото. Откройте её и пролистайте: ингредиенты по разделам, шаги с фото, видео с YouTube с 0:30, таймер, заметки автора. Если что-то не запустилось, пришлите мне последние 20 строк из терминала.
3. **Проверка переводов.** На GitHub откройте `apps/web/src/i18n/locales/uk.json` (украинский) и `sv.json` (шведский), нажмите **Raw** и отправьте ссылку носителю языка. Проверять нужно только текст справа от `:`.
4. **Ответить на три коротких вопроса** в плане Sprint 3.
5. Токен бота пока **не нужен**. Когда понадобится, я попрошу только имя бота, а не токен.
