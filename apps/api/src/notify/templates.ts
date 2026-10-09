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

/** Messages the sender knows how to write. new_recipe / recipe_cooked arrive with BE-10 (Sprint 5). */
export function renderMessage(
  type: string,
  payload: unknown,
  lang: Lang,
  links: Links,
): Rendered | null {
  if (type === 'timer_fired') return renderTimerFired(payload as TimerFiredPayload, lang, links);
  return null;
}
