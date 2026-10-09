import {
  formatAmount,
  parseAmount,
  parseNumber,
  parseYoutube,
  scaleAmount,
  UNITS,
  type Lang,
} from '@cookbook/recipe-core';
import type {
  Difficulty,
  Photo,
  QtyKind,
  Recipe,
  RecipeStatus,
  RoundClass,
  Video,
  Visibility,
} from '../api/types';

/**
 * FE-04 recipe editor state (PRD 2.2 steps 7-9, D-035). Pure functions only: the screen keeps an
 * EdRecipe, and `toBody` turns it into the POST/PATCH /recipes body (D-022: the whole content is
 * sent every time; ids from the last read are kept so links survive an edit).
 */
export type EdIngredient = {
  /** Stable while the editor is open: the id of a saved line, or "n<number>" for a new one. */
  key: string;
  id: string | null;
  /** Section ("Для теста"); null = no section, '' = a new section not named yet. */
  group: string | null;
  name: string;
  kind: QtyKind;
  /** As typed: "4", "1,5", "½", "2–3". Empty for to_taste / pinch / unparsed. */
  amount: string;
  unitCode: string | null;
  /** The unit as written; shown only when there is no unit code (e.g. "стакан с горкой"). */
  unitRaw: string;
  optional: boolean;
  note: string;
  rawLine: string | null;
  /** The parser's confidence; cleared when the author changes the line (it is theirs now). */
  confidence: number | null;
  /**
   * How a saved line rounds (PRD 5.3), kept while its name is unchanged. A new or renamed line
   * leaves it to the API, which derives it from the name.
   */
  rounding: { name: string; roundClass: RoundClass; minPiece: number | null } | null;
};

export type EdLink = { key: string; share: number };
export type EdTimer = { key: string; label: string; minutes: string };
export type EdStep = {
  key: string;
  id: string | null;
  title: string | null;
  /** Canonical text: `{ing:<ingredient key>}` placeholders (shown as [Name] in the text box). */
  text: string;
  links: EdLink[];
  timers: EdTimer[];
  photo: Photo | null;
  /** YouTube link or id as typed, and the start as "m:ss". */
  video: string;
  videoStart: string;
};

export type EdRecipe = {
  id: string | null;
  status: RecipeStatus;
  title: string;
  servings: number;
  difficulty: Difficulty | null;
  prepMin: string;
  cookMin: string;
  language: Lang;
  notes: string;
  visibility: Visibility;
  /** System tag slugs. */
  tags: string[];
  /** Free-form tags, as the author wrote them. */
  customTags: string[];
  cover: Photo | null;
  ingredients: EdIngredient[];
  steps: EdStep[];
  /** Recipe videos no step uses: not editable here, kept as they are. */
  otherVideos: Video[];
};

export const MAX_TAGS = 20;
export const MAX_TIMER_MIN = 24 * 60;
export const MAX_MINUTES = 10_080;
const LANGS: readonly Lang[] = ['ru', 'uk', 'en', 'sv'];

let counter = 0;
/** A key for a new line; never a uuid, so it cannot clash with a saved id. */
export const newKey = (prefix = 'n'): string => `${prefix}${++counter}`;

export const emptyIngredient = (group: string | null = null): EdIngredient => ({
  key: newKey(),
  id: null,
  group,
  name: '',
  kind: 'exact',
  amount: '',
  unitCode: null,
  unitRaw: '',
  optional: false,
  note: '',
  rawLine: null,
  confidence: null,
  rounding: null,
});

export const emptyStep = (): EdStep => ({
  key: newKey('s'),
  id: null,
  title: null,
  text: '',
  links: [],
  timers: [],
  photo: null,
  video: '',
  videoStart: '',
});

export function emptyRecipe(language: Lang, inBook: boolean): EdRecipe {
  return {
    id: null,
    status: 'draft',
    title: '',
    servings: 4,
    difficulty: null,
    prepMin: '',
    cookMin: '',
    language,
    notes: '',
    visibility: inBook ? 'book' : 'private',
    tags: [],
    customTags: [],
    cover: null,
    ingredients: [emptyIngredient()],
    steps: [emptyStep()],
    otherVideos: [],
  };
}

/* ---------------------------------------------------------------- numbers as typed */

const GLYPHS: Array<[number, string]> = [
  [1 / 2, '½'],
  [1 / 3, '⅓'],
  [2 / 3, '⅔'],
  [1 / 4, '¼'],
  [3 / 4, '¾'],
  [1 / 8, '⅛'],
  [3 / 8, '⅜'],
  [5 / 8, '⅝'],
  [7 / 8, '⅞'],
];

/** A stored number as the author would type it: 1.5 -> "1½", 0.3 -> "0,3" in ru/uk/sv. */
export function numberInput(v: number, lang: Lang): string {
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  if (frac > 1e-6) {
    const glyph = GLYPHS.find(([f]) => Math.abs(f - frac) < 1e-3);
    if (glyph) return `${whole > 0 ? whole : ''}${glyph[1]}`;
  }
  const text = String(Math.round(v * 1000) / 1000);
  return lang === 'en' ? text : text.replace('.', ',');
}

function amountInput(min: number | null, max: number | null, lang: Lang): string {
  if (min === null) return '';
  if (max === null || Math.abs(max - min) < 1e-9) return numberInput(min, lang);
  return `${numberInput(min, lang)}–${numberInput(max, lang)}`;
}

const minutesInput = (sec: number, lang: Lang) => numberInput(sec / 60, lang);

/** "1:30" -> 90, "1:02:03" -> 3723, "45" -> 45. null when it is not a time. */
export function parseStart(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d{1,5}$/.test(p))) return null;
  const n = parts.map(Number);
  const sec = n.reduce((acc, x) => acc * 60 + x, 0);
  if (parts.length > 1 && n.slice(1).some((x) => x >= 60)) return null;
  return sec <= 86_400 ? sec : null;
}

export function startInput(sec: number | null): string {
  if (sec === null) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Units offered for a recipe language: those the language writes (plus the one already chosen). */
export function unitChoices(lang: Lang, current: string | null): string[] {
  return UNITS.filter((u) => u.aliases[lang].length > 0 || u.code === current).map((u) => u.code);
}

/* ---------------------------------------------------------------- from the API */

export function fromRecipe(r: Recipe, uiLang: Lang): EdRecipe {
  const lang: Lang = (LANGS as readonly string[]).includes(r.language ?? '')
    ? (r.language as Lang)
    : uiLang;
  const videoById = new Map(r.videos.map((v) => [v.id, v]));
  const usedVideos = new Set(r.steps.map((s) => s.video_id));
  return {
    id: r.id,
    status: r.status,
    title: r.title,
    servings: r.servings,
    difficulty: r.difficulty,
    prepMin: r.prep_min === null ? '' : String(r.prep_min),
    cookMin: r.cook_min === null ? '' : String(r.cook_min),
    language: lang,
    notes: r.author_notes ?? '',
    visibility: r.visibility,
    tags: r.tags.filter((t) => t.custom_name === null).map((t) => t.slug),
    customTags: r.tags.filter((t) => t.custom_name !== null).map((t) => t.custom_name!),
    cover: r.cover,
    ingredients: [...r.ingredients]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        key: i.id,
        id: i.id,
        group: i.group_label,
        name: i.name,
        kind: i.qty_kind,
        amount: amountInput(i.amount_min, i.amount_max, lang),
        unitCode: i.unit_code,
        unitRaw: i.unit_raw ?? '',
        optional: i.optional,
        note: i.note ?? '',
        rawLine: i.raw_line,
        confidence: i.parse_confidence,
        rounding: { name: i.name, roundClass: i.round_class, minPiece: i.min_piece },
      })),
    steps: [...r.steps]
      .sort((a, b) => a.position - b.position)
      .map((s) => {
        const video = s.video_id ? videoById.get(s.video_id) : undefined;
        return {
          key: s.id,
          id: s.id,
          title: s.title,
          text: s.body,
          links: s.ingredients.map((l) => ({ key: l.ingredient_id, share: l.portion_fraction })),
          timers: [...s.timers]
            .sort((a, b) => a.position - b.position)
            .map((t) => ({
              key: t.id,
              label: t.label,
              minutes: minutesInput(t.duration_sec, lang),
            })),
          photo: s.photo,
          video: video ? `https://youtu.be/${video.youtube_id}` : '',
          videoStart: video ? startInput(s.video_start_sec) : '',
        };
      }),
    otherVideos: r.videos.filter((v) => !usedVideos.has(v.id)),
  };
}

/* ---------------------------------------------------------------- [Name] tokens in step text */

/**
 * The label a step text shows for an ingredient: its name, or with the section / a number when two
 * ingredients have the same name (owner decision: the editor inserts "name (amount)").
 */
export function tokenLabels(ings: EdIngredient[]): Map<string, string> {
  const norm = (s: string) => s.trim().toLocaleLowerCase();
  const count = new Map<string, number>();
  for (const i of ings) count.set(norm(i.name), (count.get(norm(i.name)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const i of ings) {
    const base = (i.name.trim() || '?').replace(/[[\]]/g, '');
    const n = norm(i.name);
    if ((count.get(n) ?? 0) < 2) labels.set(i.key, base);
    else {
      const k = (seen.get(n) ?? 0) + 1;
      seen.set(n, k);
      labels.set(i.key, i.group?.trim() ? `${base} · ${i.group.trim()}` : `${base} ${k}`);
    }
  }
  return labels;
}

const PLACEHOLDER = /\{ing:([A-Za-z0-9_-]{1,64})\}/g;
const TOKEN = /\[([^[\]\n]{1,160})\]/g;

/** Canonical text -> what the text box shows: {ing:key} becomes [Name]. */
export function displayText(text: string, labels: Map<string, string>): string {
  return text.replace(PLACEHOLDER, (all, key: string) => {
    const label = labels.get(key);
    return label === undefined ? all : `[${label}]`;
  });
}

/** What the author typed -> canonical text: [Name] of a current ingredient becomes {ing:key}. */
export function canonicalText(display: string, labels: Map<string, string>): string {
  const byLabel = new Map<string, string>();
  for (const [key, label] of labels) byLabel.set(label, key);
  let out = '';
  let at = 0;
  for (const m of display.matchAll(TOKEN)) {
    const key = byLabel.get(m[1]!);
    if (key === undefined) continue;
    out += plain(display.slice(at, m.index)) + `{ing:${key}}`;
    at = m.index + m[0].length;
  }
  return out + plain(display.slice(at));
}
/** Text typed by hand never becomes a placeholder by accident. */
const plain = (s: string) => s.replaceAll('{ing:', '{ ing:');

/** The text inserted by "Insert into text": the name, then the amount in brackets. */
export const insertion = (ing: EdIngredient, labels: Map<string, string>): string =>
  `${ing.name.trim()} ([${labels.get(ing.key) ?? ing.name.trim()}])`;

/* ---------------------------------------------------------------- amounts */

/** The ingredient's amount as the API would store it; null when it cannot be read. */
export function readAmount(
  i: EdIngredient,
): { kind: QtyKind; min: number | null; max: number | null } | null {
  const text = i.amount.trim();
  if (!text) {
    if (i.kind === 'exact' || i.kind === 'range') return null;
    return { kind: i.kind, min: null, max: null };
  }
  const a = parseAmount(text);
  if (!a || a.min <= 0 || a.max > 99_999_999) return null;
  return { kind: a.max - a.min > 1e-9 ? 'range' : 'exact', min: a.min, max: a.max };
}

/** How a placeholder will read on the card (D-029): the amount, or the step's share of it. */
export function amountPreview(
  i: EdIngredient,
  share: number,
  langs: { recipeLang: Lang; uiLang: Lang },
): string {
  const a = readAmount(i);
  if (!a || a.kind === 'unparsed') return i.name.trim();
  return formatAmount(
    scaleAmount(
      {
        qtyKind: a.kind,
        amountMin: a.min,
        amountMax: a.kind === 'range' ? a.max : null,
        unitCode: a.kind === 'exact' || a.kind === 'range' ? i.unitCode : null,
        unitRaw: i.unitRaw || null,
        roundClass: 'continuous',
        minPiece: null,
        rawLine: i.rawLine ?? i.name,
        name: i.name,
      },
      share,
    ),
    langs,
  );
}

/** The step text as the card will show it. */
export function previewText(
  step: EdStep,
  ings: EdIngredient[],
  langs: { recipeLang: Lang; uiLang: Lang },
): string {
  const byKey = new Map(ings.map((i) => [i.key, i]));
  return step.text.replace(PLACEHOLDER, (_all, key: string) => {
    const ing = byKey.get(key);
    if (!ing) return '';
    const share = step.links.find((l) => l.key === key)?.share ?? 1;
    return amountPreview(ing, share, langs);
  });
}

/* ---------------------------------------------------------------- portions */

/** How much of an ingredient the steps use altogether (ignoring one step). */
export function usedShare(steps: EdStep[], ingKey: string, exceptStep?: string): number {
  let sum = 0;
  for (const s of steps) {
    if (s.key === exceptStep) continue;
    for (const l of s.links) if (l.key === ingKey) sum += l.share;
  }
  return sum;
}

/** A new link gets what is left of the ingredient (all of it when no other step uses it). */
export function defaultShare(steps: EdStep[], ingKey: string, stepKey: string): number {
  const left = 1 - usedShare(steps, ingKey, stepKey);
  return left > 0.005 ? Math.round(left * 10_000) / 10_000 : 1;
}

export const SHARE_CHOICES = [1, 3 / 4, 2 / 3, 1 / 2, 1 / 3, 1 / 4];

/* ---------------------------------------------------------------- edits that touch several parts */

/** Removing an ingredient unlinks it and turns its placeholders back into plain text. */
export function removeIngredient(
  r: EdRecipe,
  key: string,
  langs: { recipeLang: Lang; uiLang: Lang },
): EdRecipe {
  const ing = r.ingredients.find((i) => i.key === key);
  if (!ing) return r;
  const ingredients = r.ingredients.filter((i) => i.key !== key);
  const steps = r.steps.map((s) => {
    const share = s.links.find((l) => l.key === key)?.share ?? 1;
    return {
      ...s,
      links: s.links.filter((l) => l.key !== key),
      text: s.text.replaceAll(`{ing:${key}}`, amountPreview(ing, share, langs)),
    };
  });
  return { ...r, ingredients, steps };
}

/**
 * Moves a line one place up or down. At a section edge the line first joins the neighbouring
 * section (it changes section without changing place), so lines can move between sections.
 */
export function moveIngredient(list: EdIngredient[], key: string, dir: -1 | 1): EdIngredient[] {
  const i = list.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  if (next[j]!.group !== next[i]!.group) {
    next[i] = { ...next[i]!, group: next[j]!.group };
    return next;
  }
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function move<T extends { key: string }>(list: T[], key: string, dir: -1 | 1): T[] {
  const i = list.findIndex((x) => x.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** Consecutive lines of the same section, for display. */
export function sections(
  list: EdIngredient[],
): Array<{ group: string | null; items: EdIngredient[] }> {
  const out: Array<{ group: string | null; items: EdIngredient[] }> = [];
  for (const i of list) {
    const last = out[out.length - 1];
    if (last && last.group === i.group) last.items.push(i);
    else out.push({ group: i.group, items: [i] });
  }
  return out;
}

/* ---------------------------------------------------------------- checks */

export type FieldError =
  | 'title'
  | 'servings'
  | 'minutes'
  | 'name'
  | 'amount'
  | 'section'
  | 'shares'
  | 'timer'
  | 'video'
  | 'video_start'
  | 'tags'
  | 'step'
  | 'missing_ingredients'
  | 'missing_steps';

/** Field keys: "title", "ing:<key>:amount", "step:<key>:video", "section:<first line key>" ... */
export type Errors = Record<string, FieldError>;

const isBlankIngredient = (i: EdIngredient) => !i.name.trim() && !i.amount.trim();
const isBlankStep = (s: EdStep) =>
  !s.text.trim() && !s.photo && s.timers.length === 0 && !s.video.trim() && s.links.length === 0;

function readMinutes(text: string): number | null | 'bad' {
  const t = text.trim();
  if (!t) return null;
  return /^\d{1,5}$/.test(t) && Number(t) <= MAX_MINUTES ? Number(t) : 'bad';
}

function timerSeconds(t: EdTimer): number | null {
  const m = parseNumber(t.minutes.trim());
  if (m === null || m <= 0 || m > MAX_TIMER_MIN) return null;
  return Math.max(1, Math.round(m * 60));
}

/**
 * What must be fixed before saving (any status) or publishing (PRD 2.2 step 10: a title, servings,
 * at least one ingredient and one step). Empty lines and steps are left out, not reported.
 */
export function check(r: EdRecipe, publishing: boolean): Errors {
  const e: Errors = {};
  if (!r.title.trim()) e.title = 'title';
  if (!(r.servings > 0)) e.servings = 'servings';
  if (readMinutes(r.prepMin) === 'bad') e.prep = 'minutes';
  if (readMinutes(r.cookMin) === 'bad') e.cook = 'minutes';
  const ings = r.ingredients.filter((i) => !isBlankIngredient(i));
  for (const s of sections(ings)) {
    if (s.group !== null && !s.group.trim()) e[`section:${s.items[0]!.key}`] = 'section';
  }
  for (const i of ings) {
    if (!i.name.trim()) e[`ing:${i.key}:name`] = 'name';
    if (!readAmount(i)) e[`ing:${i.key}:amount`] = 'amount';
  }
  const steps = r.steps.filter((s) => !isBlankStep(s));
  for (const s of steps) {
    for (const t of s.timers)
      if (timerSeconds(t) === null) e[`step:${s.key}:timer:${t.key}`] = 'timer';
    if (s.video.trim() && !parseYoutube(s.video)) e[`step:${s.key}:video`] = 'video';
    if (s.videoStart.trim() && parseStart(s.videoStart) === null)
      e[`step:${s.key}:video_start`] = 'video_start';
    for (const l of s.links) {
      if (usedShare(steps, l.key) > 1 + 1e-6) e[`step:${s.key}:shares`] = 'shares';
    }
  }
  if (r.tags.length + r.customTags.length > MAX_TAGS) e.tags = 'tags';
  if (publishing) {
    if (ings.length === 0) e.ingredients = 'missing_ingredients';
    if (!steps.some((s) => s.text.trim())) e.steps = 'missing_steps';
  }
  return e;
}

/* ---------------------------------------------------------------- to the API */

export type RecipeBody = Record<string, unknown> & {
  ingredients: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
};

/**
 * The POST / PATCH /recipes body, plus which editor line each array entry came from (to show a
 * server validation error at the right place). Call `check` first: this assumes valid input.
 */
export function toBody(
  r: EdRecipe,
  status: RecipeStatus,
): { body: RecipeBody; ingredientKeys: string[]; stepKeys: string[] } {
  const ings = r.ingredients.filter((i) => !isBlankIngredient(i));
  const known = new Set(ings.map((i) => i.key));
  const steps = r.steps.filter((s) => !isBlankStep(s));

  const videos: Array<{ ref: string; id?: string; youtube_id: string }> = r.otherVideos.map(
    (v) => ({
      ref: v.id,
      id: v.id,
      youtube_id: v.youtube_id,
    }),
  );
  const videoRef = (youtubeId: string): string => {
    const found = videos.find((v) => v.youtube_id === youtubeId);
    if (found) return found.ref;
    const ref = `v${videos.length + 1}`;
    videos.push({ ref, youtube_id: youtubeId });
    return ref;
  };

  const body: RecipeBody = {
    title: r.title.trim(),
    servings: r.servings,
    difficulty: r.difficulty,
    prep_min: readMinutes(r.prepMin) as number | null,
    cook_min: readMinutes(r.cookMin) as number | null,
    language: r.language,
    author_notes: r.notes.trim() || null,
    visibility: r.visibility,
    status,
    tags: [...r.tags, ...r.customTags.map((t) => t.trim()).filter(Boolean)],
    cover_media_id: r.cover?.id ?? null,
    ingredients: ings.map((i) => {
      const a = readAmount(i)!;
      const counted = a.kind === 'exact' || a.kind === 'range';
      const keep = i.rounding && i.rounding.name.trim() === i.name.trim() ? i.rounding : null;
      return {
        ref: i.key,
        ...(i.id ? { id: i.id } : {}),
        group_label: i.group?.trim() || null,
        name: i.name.trim(),
        qty_kind: a.kind,
        amount_min: a.min,
        amount_max: a.kind === 'range' ? a.max : null,
        unit_code: counted || a.kind === 'unparsed' ? i.unitCode : null,
        unit_raw: i.unitRaw.trim() || null,
        optional: i.optional,
        note: i.note.trim() || null,
        raw_line: i.rawLine,
        parse_confidence: i.confidence,
        ...(keep ? { round_class: keep.roundClass, min_piece: keep.minPiece } : {}),
      };
    }),
    steps: steps.map((s) => {
      const yt = s.video.trim() ? parseYoutube(s.video) : null;
      const ref = yt ? videoRef(yt.id) : null;
      return {
        ...(s.id ? { id: s.id } : {}),
        title: s.title,
        // A placeholder for a line that is gone (or empty) would be refused by the API.
        body: s.text.replace(PLACEHOLDER, (all, key: string) => (known.has(key) ? all : '')),
        photo_media_id: s.photo?.id ?? null,
        video_ref: ref,
        video_start_sec: ref ? (parseStart(s.videoStart) ?? yt?.startSec ?? null) : null,
        ingredients: s.links
          .filter((l) => known.has(l.key))
          .map((l) => ({ ref: l.key, portion_fraction: l.share })),
        timers: s.timers.map((t) => ({
          label: t.label.trim().slice(0, 100) || '⏱',
          duration_sec: timerSeconds(t)!,
        })),
      };
    }),
  };
  body.videos = videos;
  return { body, ingredientKeys: ings.map((i) => i.key), stepKeys: steps.map((s) => s.key) };
}

/**
 * Where a server error belongs: NOT_PUBLISHABLE lists the missing parts; VALIDATION_ERROR gives
 * paths into the body ("ingredients[3].amount_min"). Anything else is shown as a general error.
 */
export function serverErrors(
  code: string,
  details: unknown,
  keys: { ingredientKeys: string[]; stepKeys: string[] },
): Errors | null {
  const e: Errors = {};
  if (code === 'NOT_PUBLISHABLE') {
    const missing = (details as { missing?: unknown } | undefined)?.missing;
    if (!Array.isArray(missing)) return null;
    for (const m of missing) {
      if (m === 'title') e.title = 'title';
      if (m === 'servings') e.servings = 'servings';
      if (m === 'ingredients') e.ingredients = 'missing_ingredients';
      if (m === 'steps') e.steps = 'missing_steps';
    }
    return Object.keys(e).length ? e : null;
  }
  if (code !== 'VALIDATION_ERROR' || !Array.isArray(details)) return null;
  for (const d of details as Array<{ path?: unknown }>) {
    const path = typeof d.path === 'string' ? d.path : '';
    const m = /^(ingredients|steps)\[(\d+)\]\.?([a-z_]*)/.exec(path);
    if (path === 'title') e.title = 'title';
    else if (path === 'servings') e.servings = 'servings';
    else if (m?.[1] === 'ingredients') {
      const key = keys.ingredientKeys[Number(m[2])];
      if (key)
        e[`ing:${key}:${m[3] === 'name' ? 'name' : 'amount'}`] =
          m[3] === 'name' ? 'name' : 'amount';
    } else if (m?.[1] === 'steps') {
      const key = keys.stepKeys[Number(m[2])];
      if (key) e[`step:${key}:text`] = 'step';
    } else if (path === 'steps') {
      for (const key of keys.stepKeys) e[`step:${key}:shares`] = 'shares';
    }
  }
  return Object.keys(e).length ? e : null;
}
