# Family Cookbook in Telegram: Idea Description (original brief)

> Author's original idea description, translated from Russian into English. It is context and product intent for `docs/PRD.md`.
> **If this brief and the PRD disagree, the PRD wins.** The PRD (section 1.5) records where the brief was ambiguous or self-contradictory and how that was resolved.
> Items marked "later" belong to stages after the MVP (see "What's next" at the end).

## The idea in short

A mini-app inside Telegram: a shared cookbook for me, my family and friends. You can add your own recipes, save other people's, share them in chats and cook from them step by step.

It differs from an ordinary recipe website in three ways:

1. **These are recipes of your own people, not a faceless catalog.** "Mom's borscht", "Olya's pie", "that same pilaf".
2. **It can calculate.** If I have 300 g of minced meat, it recalculates the whole recipe for that amount.
3. **It is convenient to cook from.** One step on the screen, large text, built-in timers.

At first this is a project for myself and my acquaintances. If people like it and it takes off, it can be opened more widely.

## Who it is for and why Telegram

The main users are me, my family and friends who cook and exchange recipes. Right now these recipes are scattered across chats, notes, screenshots and grandmothers' notebooks.

Telegram was chosen because we are all already in it:

- **Nothing to install.** The app opens right from a chat; sign-in is with the Telegram account.
- **Easy sharing.** A recipe is sent to any chat as a link with a nice preview, and the recipient opens it with one tap.
- **There is a bot for notifications:** "Anya cooked your pie", "Timer is ready", "New recipe in the book".
- **The language is picked up automatically** from the Telegram settings.

## Recipe: what it contains

| Part | What can be specified |
|---|---|
| Title and photo of the dish | One or several photos |
| Ingredients | Any products in any units: grams, pieces, spoons, cups, "to taste" |
| Steps | Text, a photo per step, a timer per step |
| Video | A YouTube link, which can be attached to a specific step |
| Difficulty | Easy, medium, hard |
| Time | Preparation and cooking, separately |
| Servings | How many people it is designed for |
| Tags | Breakfast, soup, baking, lean/fasting, gluten-free, etc. |
| Author's notes | Secrets and tips: "the dough is better left overnight" |

## How to add a recipe quickly

Filling in a recipe by hand takes long, and if it takes long, acquaintances will not add anything. So adding must be as simple as possible:

- **Paste the whole text** from a chat, a website or notes. The app splits it into ingredients and steps by itself; the user only has to check it.
- **Forward a message to the bot**, and the recipe lands in drafts.
- **Photograph a page** from a notebook or book and the text is recognized (this comes after the first version).
- **Write ingredients however is convenient:** "2 tbsp flour" or "a pinch of salt". The app understands the quantity and the unit by itself.

## Smart features

### Recalculation for what you have at home

This is the app's main feature. It works in three ways:

- **By servings.** The recipe is for 4 people and there are 6 of us. All quantities are recalculated automatically.
- **From one product.** "I have 500 g of minced meat instead of 800." The app recalculates the whole recipe for that minced meat.
- **From several products.** "I have 300 g of flour, 2 eggs and 200 ml of milk." The app finds how many servings it will make and shows what is missing.

In the first version, recalculation uses the same units the author wrote the recipe in: it was 800 g, 4 eggs and 2 cups; it becomes 500 g, 2.5 eggs and 1.25 cups. Converting between measures (cups to grams, Swedish dl, msk, tsk, krm) requires a density reference: "a cup of flour" weighs differently from "a cup of sugar". That comes in the next step.

**Rounding for countable products and indivisible spices.** Recalculation often gives "1.3 eggs" or "0.7 bay leaf", so the app shows a clear hint:

- 1.3 eggs → "1 pc (or whisk 2 pcs and take 2/3)";
- 0.7 bay leaf → "1 pc";
- "to taste" and "a pinch" are not recalculated.

## Cooking mode

You press "Cook", and the recipe turns into a step-by-step guide:

- one step on the screen, large font;
- flip with a swipe, so you do not have to touch small buttons with dirty hands;
- the screen does not go dark while you cook (if the phone does not allow it, a fallback method is used);
- timers right in the steps, several can run at the same time; the timer runs on the server, so the bot sends a message exactly on time even if the app is minimized or closed;
- each step shows only the ingredients needed for it, already recalculated;
- the video can be opened right at the needed step.

**Cooking is not reset.** The current step number and the recalculated recipe are saved on the phone, so an accidental page refresh or loss of connection will not make you start over.

## Shopping list (later)

You select several recipes, and the app builds a combined list. Identical products are summed: "200 g flour" and "300 g flour" become "500 g flour". The list can be ticked off in the store or sent to a chat. This comes after the first version.

## What to cook from what I have (later)

You enter the products from the fridge, and the app shows recipes from the book that you can cook right now or with almost no extra shopping. This comes after the first version.

## Shared book and access

At the center of the app is the shared book. I create it and invite acquaintances with a link. Everyone who joins can add their own recipes and see everyone else's. In the first version there is one book, and each person also has a personal shelf. Several books ("Family", "Friends") come later.

Each recipe has three visibility levels:

| Visibility | Who sees it |
|---|---|
| Only me | Drafts and personal notes |
| Book | All members of the book |
| By link | Anyone I sent the recipe link to |

There is also:

- **"Saved":** a personal shelf with other people's recipes you liked.
- **Collections:** your own selections such as "Quick dinners" or "For New Year".
- **"My version":** a copy of someone else's recipe where you can change ingredients and add your own notes without touching the original. The author sees that the recipe has versions. This comes in the next step.
- **Search and filters** by title, ingredient, tag, difficulty and time.

## Reactions

You can put a reaction on any recipe that is not yours. There are two types: quick emotions and actions that mean something.

**Emotions, one tap:**

| Reaction | Meaning |
|---|---|
| ❤️ | Like |
| 😋 | Looks delicious |
| 🔥 | Fire |
| 💡 | Interesting idea |
| 🤔 | Want to try |

**Actions, the most valuable:**

| Reaction | Meaning |
|---|---|
| 👨‍🍳 I cooked it | The main reaction; you can add a photo and a few words |
| 🔁 I'll cook it again | The recipe became a favorite |
| ✏️ My version | Cooked with changes and saved them |

There are no dislikes: among acquaintances they only create awkwardness. Instead you can leave the author a soft note, for example "turned out a bit salty" or "step 3 is unclear".

When someone cooks a recipe, the author gets a message from the bot: "Lena cooked your pie", with her photo. This is the best motivation to share recipes.

## The game part (later, not in the first version)

The game is there to make cooking and sharing more fun. It goes into the next step, not the first version, once the foundation already works. Reactions exist from the very start, though.

The main rule: **points are given for actually cooking, not for taps.** Otherwise it turns into a race for points.

### Points and ranks

- Points are awarded for a cooked dish (more for someone else's recipe), for finishing cooking mode to the end, and for a new cuisine.
- The author gets points when others cook their recipe. This encourages publishing good recipes, not many.
- The rank changes as you grow, for example: Kitchen Intern → Home Cook → Master of the Stove → Chef.

### Achievements (examples)

| Achievement | What for |
|---|---|
| The First Pancake | First cooked dish |
| Family Tradition | Cooked a relative's recipe |
| World Cuisine | Dishes from 5 different cuisines |
| No Leftovers | Cooked from what was at home |
| Book Hit | Your recipe was cooked by 5 people |
| Night Cook | Cooked after midnight |

### Shared goals instead of competition

Among acquaintances a hard ranking can spoil the mood. So the emphasis is on the book's shared goals:

- "Our book reached 100 recipes."
- "This month we cooked 40 dishes together."
- A challenge of the week: "Everyone cooks soup" or "A 15-minute dish".
- Instead of a leaderboard, a soft "Cook of the week".

### No stress and no point-farming

- A streak is counted by weeks, not days: "cooked at least once a week". If you skip a day, you lose nothing.
- Little is awarded for your own recipe, and points for one recipe are given no more than once a week.

## Languages

The interface is in four languages: Russian, Ukrainian, English and Swedish. The language is chosen automatically from the Telegram settings and can be changed manually. All texts are stored in separate translation files, so four languages from day one hardly complicate development.

Recipes are not translated: everyone writes in their own language, and the recipe is stored as written. If needed, recipe translation can be added later.

Swedish measures (dl, msk, tsk, krm) and their conversion to grams and spoons come with the measures reference in the next step.

## What it looks like in real life

1. I forward Mom's cabbage-roll recipe from the family chat to the bot. The app splits it into ingredients and steps, I add a photo and publish it to the "Family" book.
2. My sister receives a notification about the new recipe. She saves it for herself.
3. In the evening she has only 500 g of minced meat instead of 800. She enters that, and the recipe is recalculated.
4. She presses "Cook" and goes through the steps; the timer reminds her to turn off the stove.
5. After dinner she puts 👨‍🍳 "I cooked it" with a photo. I get a message from the bot. In later versions we will both also get points, and the book will move closer to the month's goal.
6. My sister adds her own salad recipe, and it all starts again.

That cycle is the point: every cooked recipe motivates people to add new ones.

## What's next

### Stages

| Stage | What is included | Main goal |
|---|---|---|
| **1. First version (MVP)** | Recipe card (photo, video, ingredients, steps); recalculation by servings and from one product with rounding rules; cooking mode (server-side timers via the bot, saving the step, keeping the screen awake); one shared book and a personal "Saved" shelf; quick add: pasting text and forwarding to the bot; reactions ("I cooked it" with a photo, and quick emotions); sharing by link with a preview; interface in 4 languages | Launch the cycle "shared, cooked step by step, reacted" and verify the value with the family |
| **2. Next step** | Reference of measures and densities (cups and grams, Swedish measures); "My version" of recipes; several books; points, ranks, achievements, shared goals | Involve people more deeply and handle non-standard ingredients conveniently |
| **3. Conveniences** | Recognition of a notebook page; shopping list with real-time sync; "what to cook from what I have"; equipment notes ("for my oven"); challenges of the week | Everyday comfort and moving old recipes in |

### Later, if it takes off

Public catalog, subscriptions to authors, calories/protein/fat/carbs (КБЖУ), weekly menu planner. Goal: reach a wider audience.
