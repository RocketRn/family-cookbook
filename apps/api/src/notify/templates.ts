import { cleanText, escapeHtml, isolate, truncate } from './text.js';

export type Lang = 'ru' | 'uk' | 'en' | 'sv';
export type Links = { botUsername: string; appShortName: string };
export type Rendered = {
  text: string;
  reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> };
};

/** What the worker stores for a fired timer (a snapshot taken when the timer started). */
export type TimerFiredPayload = {
  timer_id: string;
  label: string;
  recipe_id: string | null;
  recipe_title: string | null;
  step_number: number | null;
};

/** PRD 4.4: "⏰ {label} — done! {recipe title}, step {n}", in the recipient's interface language. */
const TEXTS: Record<
  Lang,
  { fired: string; context: string; title: string; openStep: string; openApp: string }
> = {
  ru: {
    fired: '⏰ {label} — готово!',
    context: '«{title}», шаг {n}',
    title: '«{title}»',
    openStep: 'Открыть шаг',
    openApp: 'Открыть приложение',
  },
  uk: {
    fired: '⏰ {label} — готово!',
    context: '«{title}», крок {n}',
    title: '«{title}»',
    openStep: 'Відкрити крок',
    openApp: 'Відкрити застосунок',
  },
  en: {
    fired: '⏰ {label} — done!',
    context: '“{title}”, step {n}',
    title: '“{title}”',
    openStep: 'Open the step',
    openApp: 'Open the app',
  },
  sv: {
    fired: '⏰ {label} — klart!',
    context: '”{title}”, steg {n}',
    title: '”{title}”',
    openStep: 'Öppna steget',
    openApp: 'Öppna appen',
  },
};

/** Visible characters of user text in a message: enough for any real title, far below Telegram's 4096. */
export const LABEL_MAX = 100;
export const TITLE_MAX = 64;

/** User text, made safe: cleaned, cut, escaped, isolated. */
const safe = (s: string, max: number) => isolate(escapeHtml(truncate(cleanText(s), max)));

/** One pass: text inserted for a placeholder is never scanned again (a label "{title}" stays as it is). */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all);
}

/** PRD 4.7 deep link into cooking mode at the step: cook_<uuid without dashes>_<step number>. */
export function cookLink(links: Links, recipeId: string | null, step: number | null): string {
  const base = `https://t.me/${encodeURIComponent(links.botUsername)}/${encodeURIComponent(links.appShortName)}`;
  if (!recipeId || !/^[0-9a-f-]{36}$/i.test(recipeId)) return base;
  return `${base}?startapp=cook_${recipeId.replace(/-/g, '').toLowerCase()}_${step ?? 1}`;
}

export function renderTimerFired(p: TimerFiredPayload, lang: Lang, links: Links): Rendered {
  const t = TEXTS[lang] ?? TEXTS.en;
  const label = safe(p.label || '⏰', LABEL_MAX);
  const lines = [fill(t.fired, { label })];
  if (p.recipe_title) {
    const title = safe(p.recipe_title, TITLE_MAX);
    lines.push(
      p.step_number
        ? fill(t.context, { title, n: String(p.step_number) })
        : fill(t.title, { title }),
    );
  }
  const url = cookLink(links, p.recipe_id, p.step_number);
  return {
    text: lines.join('\n'),
    reply_markup: { inline_keyboard: [[{ text: p.recipe_id ? t.openStep : t.openApp, url }]] },
  };
}

/** BE-10 (PRD 4.4): what the worker stores for "I cooked it" (a snapshot made with the mark). */
export type RecipeCookedPayload = {
  reaction_id: string;
  recipe_id: string;
  recipe_title: string;
  cook_name: string | null;
  note: string | null;
  photo_key: string | null;
};

/** PRD 4.4: "{Name} cooked «{title}»" + the words, in the author's language. */
const COOKED_TEXTS: Record<Lang, { cooked: string; someone: string; open: string }> = {
  ru: {
    cooked: '👨‍🍳 <b>{name}</b> приготовил(а) ваш рецепт {title}',
    someone: 'Кто-то',
    open: 'Открыть рецепт',
  },
  uk: {
    cooked: '👨‍🍳 <b>{name}</b> приготував(ла) ваш рецепт {title}',
    someone: 'Хтось',
    open: 'Відкрити рецепт',
  },
  en: {
    cooked: '👨‍🍳 <b>{name}</b> cooked your recipe {title}',
    someone: 'Someone',
    open: 'Open the recipe',
  },
  sv: {
    cooked: '👨‍🍳 <b>{name}</b> lagade ditt recept {title}',
    someone: 'Någon',
    open: 'Öppna receptet',
  },
};
/** "I cooked it" words: the same limit as the API (500), which keeps the caption under 1024. */
export const NOTE_MAX = 500;
const NAME_MAX = 64;

/** PRD 4.7: a book recipe, rc_<uuid without dashes>. */
export function recipeLink(links: Links, recipeId: string): string {
  return /^[0-9a-f-]{36}$/i.test(recipeId)
    ? appLink(links, `rc_${recipeId.replace(/-/g, '').toLowerCase()}`)
    : appLink(links, null);
}

export function renderRecipeCooked(p: RecipeCookedPayload, lang: Lang, links: Links): Rendered {
  const t = COOKED_TEXTS[lang] ?? COOKED_TEXTS.en;
  const name = p.cook_name ? safe(p.cook_name, NAME_MAX) : t.someone;
  const title = fill((TEXTS[lang] ?? TEXTS.en).title, {
    title: safe(p.recipe_title || '…', TITLE_MAX),
  });
  const lines = [fill(t.cooked, { name, title })];
  if (p.note) lines.push(`💬 ${safe(p.note, NOTE_MAX)}`);
  return {
    text: lines.join('\n'),
    reply_markup: { inline_keyboard: [[{ text: t.open, url: recipeLink(links, p.recipe_id) }]] },
  };
}

/** PRD 4.4 new_recipe: a snapshot made when the recipe reached the book. */
export type NewRecipePayload = {
  recipe_id: string;
  recipe_title: string;
  author_name: string | null;
  /** Set by the worker when more than 3 messages became one (PRD 4.4). */
  collapsed?: number;
};

/** "{Name} added «{title}»"; several at once: "New recipes in the book: N" (no plural forms needed). */
const NEW_TEXTS: Record<Lang, { added: string; many: string }> = {
  ru: {
    added: '📖 <b>{name}</b> добавил(а) рецепт {title}',
    many: '📖 Новых рецептов в книге: {n}',
  },
  uk: {
    added: '📖 <b>{name}</b> додав(ла) рецепт {title}',
    many: '📖 Нових рецептів у книзі: {n}',
  },
  en: { added: '📖 <b>{name}</b> added {title}', many: '📖 New recipes in the book: {n}' },
  sv: { added: '📖 <b>{name}</b> lade till {title}', many: '📖 Nya recept i boken: {n}' },
};

export function renderNewRecipe(p: NewRecipePayload, lang: Lang, links: Links): Rendered {
  const t = NEW_TEXTS[lang] ?? NEW_TEXTS.en;
  if (p.collapsed && p.collapsed > 1) {
    return {
      text: fill(t.many, { n: String(p.collapsed) }),
      reply_markup: {
        inline_keyboard: [
          [{ text: (START_TEXTS[lang] ?? START_TEXTS.en).open, url: appLink(links, null) }],
        ],
      },
    };
  }
  const name = p.author_name
    ? safe(p.author_name, NAME_MAX)
    : (COOKED_TEXTS[lang] ?? COOKED_TEXTS.en).someone;
  const title = fill((TEXTS[lang] ?? TEXTS.en).title, {
    title: safe(p.recipe_title || '…', TITLE_MAX),
  });
  return {
    text: fill(t.added, { name, title }),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: (COOKED_TEXTS[lang] ?? COOKED_TEXTS.en).open,
            url: recipeLink(links, p.recipe_id),
          },
        ],
      ],
    },
  };
}

/** BE-07: the answer to /start, and to /start from an invitation link (join_<code>). */
const START_TEXTS: Record<Lang, { hello: string; invited: string; open: string; join: string }> = {
  ru: {
    hello:
      '👋 Здравствуйте! Это семейная книга рецептов: рецепты, пересчёт порций и таймеры для готовки. Когда таймер закончится, я напишу вам здесь.',
    invited: '👋 Вас пригласили в семейную книгу рецептов. Откройте её, чтобы присоединиться.',
    open: 'Открыть книгу',
    join: 'Открыть и присоединиться',
  },
  uk: {
    hello:
      '👋 Вітаю! Це сімейна книга рецептів: рецепти, перерахунок порцій і таймери для готування. Коли таймер закінчиться, я напишу вам тут.',
    invited: '👋 Вас запросили до сімейної книги рецептів. Відкрийте її, щоб приєднатися.',
    open: 'Відкрити книгу',
    join: 'Відкрити й приєднатися',
  },
  en: {
    hello:
      '👋 Hello! This is your family cookbook: recipes, serving sizes and cooking timers. When a timer ends, I’ll message you here.',
    invited: '👋 You’ve been invited to a family cookbook. Open it to join.',
    open: 'Open the cookbook',
    join: 'Open and join',
  },
  sv: {
    hello:
      '👋 Hej! Det här är familjens kokbok: recept, portioner och timrar för matlagning. När en timer är klar skriver jag till dig här.',
    invited: '👋 Du har bjudits in till en familjekokbok. Öppna den för att gå med.',
    open: 'Öppna kokboken',
    join: 'Öppna och gå med',
  },
};

/** The app, opened with a start parameter only when it is one Telegram allows (PRD 4.7). */
export function appLink(links: Links, start: unknown): string {
  const base = `https://t.me/${encodeURIComponent(links.botUsername)}/${encodeURIComponent(links.appShortName)}`;
  return typeof start === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(start)
    ? `${base}?startapp=${start}`
    : base;
}

export function renderBotStart(p: { start?: unknown }, lang: Lang, links: Links): Rendered {
  const t = START_TEXTS[lang] ?? START_TEXTS.en;
  const url = appLink(links, p.start);
  const invited = url.includes('?startapp=join_');
  return {
    text: invited ? t.invited : t.hello,
    reply_markup: { inline_keyboard: [[{ text: invited ? t.join : t.open, url }]] },
  };
}

/** Messages the sender knows how to write (PRD 4.4, BE-07). */
export function renderMessage(
  type: string,
  payload: unknown,
  lang: Lang,
  links: Links,
): Rendered | null {
  if (type === 'timer_fired') return renderTimerFired(payload as TimerFiredPayload, lang, links);
  if (type === 'bot_start')
    return renderBotStart((payload ?? {}) as { start?: unknown }, lang, links);
  if (type === 'recipe_cooked')
    return renderRecipeCooked(payload as RecipeCookedPayload, lang, links);
  if (type === 'new_recipe') return renderNewRecipe(payload as NewRecipePayload, lang, links);
  return null;
}
