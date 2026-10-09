# Recipe texts for parser tests

The import parser (BE-06, PRD 5.1) is tested against a **reference set** of recipe texts with their expected parse. The set lives in `packages/recipe-core/test/fixtures/import/`:

- `NN-<lang>-<name>.txt` is the recipe exactly as it would be pasted (or forwarded to the bot).
- `NN-<lang>-<name>.json` is what the parser must produce: title, servings and times, every ingredient line (section, kind, amount, unit, name, confidence), the number of steps, timers and videos.

`<lang>` is `ru`, `uk`, `en` or `sv`. The test (`test/parse-reference.test.ts`) checks every file automatically, plus the PRD quality criterion (≥ 90 % of texts and ingredient lines right) and that no text is lost.

The 10 texts there now were written for this project: ordinary recipes (шарлотка, борщ, pancakes, köttbullar…), with no personal data.

## Adding your own family recipes (later)

Real recipe texts from the family are the best test. When you have some:

1. Send them as plain text, exactly as you would paste them into the app: chat messages, notes, photos of a notebook typed out.
2. **Remove anything personal first:** names of people, phone numbers, addresses, private comments. Only the recipe should remain. Nothing is added here without your agreement.
3. They will be added as new numbered files (`11-ru-…txt` and so on) with their expected parse. If the parser gets something wrong, the expected file says what is right, and the parser is fixed until the test passes.

Do not invent or copy personal data into these files: they are part of the public repository.
