import { LANGS, type Lang } from '../types.js';
import { normalizeUnitText, resolveUnit } from '../units.js';
import {
  COOK_TIME,
  HEADINGS,
  PINCH,
  PREP_TIME,
  SERVINGS,
  STOP_WORDS,
  SUBHEADING_START,
  TASTE,
} from './dictionaries.js';
import { findDurations } from './durations.js';
import { parseIngredientLine } from './ingredient.js';
import { collapse, fold, readLine, trimEndChars, type LineInfo } from './normalize.js';
import type {
  ParsedIngredient,
  ParsedRecipe,
  ParsedStep,
  ParseOptions,
  ParseWarning,
} from './types.js';

export * from './types.js';
export { findDurations, parseIngredientLine };

/** PRD 7.1 data limits. */
const MAX_INGREDIENTS = 100;
const MAX_STEPS = 60;

// ---------------------------------------------------------------- language

/** Letters decide: Cyrillic with і/ї/є/ґ is Ukrainian, with ы/э/ъ/ё Russian; Latin with å/ä/ö Swedish. */
export function detectLanguage(text: string, fallback: Lang): Lang {
  let cyr = 0;
  let lat = 0;
  let uk = 0;
  let ru = 0;
  let sv = 0;
  for (const ch of text.toLowerCase()) {
    if (ch >= 'а' && ch <= 'я') cyr++;
    else if ('іїєґ'.includes(ch)) {
      cyr++;
      uk++;
    } else if (ch === 'ё') {
      cyr++;
      ru++;
    } else if (ch >= 'a' && ch <= 'z') lat++;
    else if ('åäö'.includes(ch)) {
      lat++;
      sv++;
    }
    if ('ыэъ'.includes(ch)) ru++;
  }
  if (cyr === 0 && lat === 0) return fallback;
  if (cyr >= lat) return uk > ru ? 'uk' : 'ru';
  return sv > 0 ? 'sv' : 'en';
}

// ---------------------------------------------------------------- line classes

type Section = 'ingredients' | 'steps' | 'notes';
const HEADING_INDEX = new Map<string, Section>();
for (const section of Object.keys(HEADINGS) as Section[])
  for (const lang of LANGS) for (const h of HEADINGS[section][lang]) HEADING_INDEX.set(h, section);

/** PRD 5.1.2: at most 40 characters, no trailing period (a colon is fine), from the dictionary. */
function headingOf(line: LineInfo): Section | null {
  const t = line.text;
  if (t.length === 0 || t.length > 40 || t.endsWith('.')) return null;
  return HEADING_INDEX.get(fold(trimEndChars(t, ': '))) ?? null;
}

const words = (s: string) => s.split(' ').filter(Boolean);

/** A unit (1-3 words) anywhere, or a taste / pinch phrase. */
function hasUnit(text: string, lang: Lang): boolean {
  const lower = fold(text);
  if (TASTE.some((p) => lower.includes(p)) || PINCH.some((p) => lower.includes(p))) return true;
  const w = words(text);
  for (let i = 0; i < w.length; i++)
    for (let k = 1; k <= 3 && i + k <= w.length; k++) {
      const candidate = w.slice(i, i + k).join(' ');
      if (normalizeUnitText(candidate) && resolveUnit(candidate, lang)) return true;
    }
  return false;
}

/** "шт." at the end is an abbreviation, not the end of a sentence. */
function endsWithSentence(text: string, lang: Lang): boolean {
  if (!text.endsWith('.')) return false;
  const last = text.slice(text.lastIndexOf(' ') + 1);
  return !resolveUnit(last, lang);
}

const scores = new WeakMap<LineInfo, number>();
/** PRD 5.1.2 score for lines outside headed sections (computed once per line). */
function ingredientScore(line: LineInfo, lang: Lang): number {
  const known = scores.get(line);
  if (known !== undefined) return known;
  let s = 0;
  if (/^\d/.test(line.text) || line.marker === 'bullet') s += 0.35;
  if (hasUnit(line.text, lang)) s += 0.3;
  if (line.text.length <= 60) s += 0.2;
  if (!endsWithSentence(line.text, lang)) s += 0.15;
  scores.set(line, s);
  return s;
}
const isIngredientLike = (line: LineInfo, lang: Lang) => ingredientScore(line, lang) >= 0.6 - 1e-9;

/** A step line has priority over the score: a step number, > 80 characters, or a sentence of >= 6 words. */
function isStepLike(line: LineInfo, lang: Lang): boolean {
  if (line.marker === 'numbered' || line.marker === 'step')
    return !isIngredientLike(line, lang) || line.marker === 'step';
  return (
    line.text.length > 80 || (endsWithSentence(line.text, lang) && words(line.text).length >= 6)
  );
}

function subheadingOf(line: LineInfo): string | null {
  const t = line.text;
  if (t.length === 0 || t.length > 40 || /\d/.test(t)) return null;
  if (!t.endsWith(':') && !SUBHEADING_START.test(t)) return null;
  return trimEndChars(line.raw, ': ').trim() || null;
}

// ---------------------------------------------------------------- metadata

type Meta = { servings: number | null; prepMin: number | null; cookMin: number | null };

const minutesOf = (s: string) => {
  const total = findDurations(s).reduce((sum, t) => sum + t.durationSec, 0);
  return total > 0 ? Math.round(total / 60) : null;
};

/** PRD 5.1.1 stage 3: only explicit phrases, only short lines. True when the line was metadata. */
function readMeta(line: LineInfo, meta: Meta): boolean {
  const t = trimEndChars(line.text, '. ');
  if (t.length === 0 || t.length > 60) return false;
  for (const re of SERVINGS) {
    const m = re.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n > 0 && n <= 999) {
        meta.servings ??= n;
        return true;
      }
    }
  }
  const prep = PREP_TIME.exec(t);
  if (prep) {
    const min = minutesOf(prep[1]!);
    if (min !== null) {
      meta.prepMin ??= min;
      return true;
    }
  }
  const cook = COOK_TIME.exec(t);
  if (cook) {
    const min = minutesOf(cook[1]!);
    if (min !== null) {
      meta.cookMin ??= min;
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- steps and links

type StepLine = { line: LineInfo; startsStep: boolean };

/** PRD 5.1.4: by step markers; else by blank lines; else each step-like line; continuation lines glue on. */
function buildSteps(
  lines: LineInfo[],
  lang: Lang,
): Array<{ text: string; videos: LineInfo['videos'] }> {
  const content = lines.filter((l) => !l.blank);
  if (content.length === 0) return [];
  const hasMarkers = content.some((l) => l.marker === 'numbered' || l.marker === 'step');
  let parts: StepLine[];
  if (hasMarkers) {
    parts = lines.map((line) => ({
      line,
      startsStep: line.marker === 'numbered' || line.marker === 'step',
    }));
  } else if (
    lines.some((l, i) => l.blank && i > 0 && i < lines.length - 1 && !lines[i - 1]!.blank)
  ) {
    parts = lines.map((line, i) => ({
      line,
      startsStep: !line.blank && (i === 0 || lines[i - 1]!.blank),
    }));
  } else {
    parts = lines.map((line, i) => ({
      line,
      startsStep: !line.blank && (i === 0 || isStepLike(line, lang)),
    }));
  }
  const steps: Array<{ text: string; videos: LineInfo['videos'] }> = [];
  for (const { line, startsStep } of parts) {
    if (line.blank) continue;
    const current = steps[steps.length - 1];
    if (startsStep || !current) steps.push({ text: line.raw, videos: [...line.videos] });
    else {
      current.text = collapse(`${current.text} ${line.raw}`);
      current.videos.push(...line.videos);
    }
  }
  return steps.filter((s) => s.text.length > 0 || s.videos.length > 0);
}

const ENDINGS = [
  'ями',
  'ами',
  'его',
  'ого',
  'ему',
  'ому',
  'ыми',
  'ими',
  'ей',
  'ой',
  'ий',
  'ый',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ов',
  'ев',
  'ах',
  'ях',
  'ам',
  'ям',
  'ом',
  'ем',
  'ую',
  'юю',
  'а',
  'я',
  'ы',
  'и',
  'у',
  'ю',
  'е',
  'о',
  'ь',
  'й',
  'і',
  'ї',
  'є',
  'arna',
  'orna',
  'erna',
  'ar',
  'er',
  'or',
  'en',
  'et',
  'es',
  's',
];
/** PRD 5.1.4 stem: light ending removal, then the first 5 letters; at least 3 letters. */
function stemOf(word: string): string | null {
  let w = fold(word);
  for (const e of ENDINGS) {
    if (w.length - e.length >= 3 && w.endsWith(e)) {
      w = w.slice(0, -e.length);
      break;
    }
  }
  w = w.slice(0, 5);
  return w.length >= 3 ? w : null;
}
const letterWords = (s: string) => fold(s).match(/\p{L}+/gu) ?? [];

function linkIngredients(ingredients: ParsedIngredient[], stepText: string): number[] {
  const prefixes = new Set<string>();
  for (const w of letterWords(stepText))
    for (let k = 3; k <= Math.min(5, w.length); k++) prefixes.add(w.slice(0, k));
  const links: number[] = [];
  ingredients.forEach((ing, i) => {
    const stems = letterWords(ing.name)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
      .map(stemOf)
      .filter((s): s is string => s !== null);
    if (stems.some((s) => prefixes.has(s))) links.push(i);
  });
  return links;
}

// ---------------------------------------------------------------- the whole text

/** BE-06 recipe text parser (PRD 5.1). Pure, linear-time, never throws on odd input. */
export function parseRecipeText(text: string, opts: ParseOptions): ParsedRecipe {
  const language = detectLanguage(text, opts.fallbackLang);
  const lines = text.split(/\r?\n/).map((l) => readLine(l, language));
  const meta: Meta = { servings: null, prepMin: null, cookMin: null };
  const consumedLines: string[] = [];
  const warnings: ParseWarning[] = [];
  const notes: string[] = [];
  const ingredientLines: Array<{ line: LineInfo; group: string | null }> = [];
  const stepLines: LineInfo[] = [];
  const videos: ParsedRecipe['videos'] = [];

  const headings = lines.map(headingOf);
  const headed = headings.some((h) => h === 'ingredients' || h === 'steps');
  if (!headed) warnings.push('no_headings');

  // Title: the first non-empty line under 100 characters before any section, if it is not metadata,
  // an ingredient or a step.
  let title: string | null = null;
  let start = 0;
  const first = lines.findIndex((l) => !l.blank);
  if (first >= 0 && headings[first] === null && lines[first]!.raw.length < 100) {
    const l = lines[first]!;
    if (!readMeta(l, { ...meta }) && !isIngredientLike(l, language) && !(l.marker === 'numbered')) {
      title = l.raw;
      videos.push(...l.videos);
      start = first + 1;
    }
  }

  /** Lines outside headed sections: metadata, ingredient-like, step-like, or notes. */
  const free: LineInfo[] = [];
  const flushFree = () => {
    classifyFree(free, language, meta, consumedLines, ingredientLines, stepLines, notes);
    free.length = 0;
  };
  let section: Section | null = null;
  let group: string | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const h = headings[i];
    if (h) {
      if (section === null) flushFree();
      section = h;
      group = null;
      consumedLines.push(line.raw);
      continue;
    }
    if (section === null) {
      free.push(line);
      continue;
    }
    if (section === 'ingredients') {
      if (line.blank) continue;
      if (readMeta(line, meta)) {
        consumedLines.push(line.raw);
        continue;
      }
      const sub = subheadingOf(line);
      if (sub) {
        group = sub;
        continue;
      }
      if (isStepLike(line, language) && !isIngredientLike(line, language)) {
        section = 'steps';
        stepLines.push(line);
        continue;
      }
      ingredientLines.push({ line, group });
    } else if (section === 'steps') {
      stepLines.push(line);
    } else if (!line.blank) {
      notes.push(line.raw);
      videos.push(...line.videos);
    }
  }
  if (section === null) flushFree();

  // Ingredients
  // Only the lines that are kept are parsed (the rest stays in the original text).
  if (ingredientLines.length > MAX_INGREDIENTS) warnings.push('truncated');
  const ingredients: ParsedIngredient[] = ingredientLines
    .slice(0, MAX_INGREDIENTS)
    .map(({ line, group: g }) => ({ ...parseIngredientLine(line.raw, language), groupLabel: g }));
  if (ingredients.length === 0) warnings.push('no_ingredients');

  // Steps
  let built = buildSteps(stepLines, language);
  if (built.length === 0) {
    warnings.push('no_steps');
    const all = lines
      .filter((l) => !l.blank)
      .map((l) => l.raw)
      .join('\n');
    if (all) built = [{ text: all, videos: [] }];
  }
  if (built.length > MAX_STEPS) {
    built = built.slice(0, MAX_STEPS);
    if (!warnings.includes('truncated')) warnings.push('truncated');
  }
  const steps: ParsedStep[] = built.map((s) => {
    let video: number | null = null;
    for (const v of s.videos) {
      videos.push(v);
      video ??= videos.length - 1;
    }
    return {
      text: s.text,
      timers: findDurations(s.text),
      links: linkIngredients(ingredients, s.text),
      video,
    };
  });

  return {
    title,
    language,
    servings: meta.servings,
    prepMin: meta.prepMin,
    cookMin: meta.cookMin,
    ingredients,
    steps,
    notes: notes.length ? notes.join('\n') : null,
    videos,
    warnings,
    consumedLines,
  };
}

/** Lines with no section heading above them (the whole text when there are no headings). */
function classifyFree(
  lines: LineInfo[],
  lang: Lang,
  meta: Meta,
  consumed: string[],
  ingredientsOut: Array<{ line: LineInfo; group: string | null }>,
  stepsOut: LineInfo[],
  notes: string[],
): void {
  type Kind = 'blank' | 'meta' | 'ingredient' | 'step' | 'sub' | 'unknown';
  const kinds: Kind[] = lines.map((l) => {
    if (l.blank) return 'blank';
    if (readMeta(l, meta)) {
      consumed.push(l.raw);
      return 'meta';
    }
    if (isStepLike(l, lang)) return 'step';
    if (isIngredientLike(l, lang)) return 'ingredient';
    return 'unknown';
  });
  // Neighbours decide unknown lines: a short line among ingredients is an ingredient (or a section
  // label), anything else after a step continues it, and the rest is a note.
  const neighbour = (i: number, dir: 1 | -1): Kind | null => {
    for (let j = i + dir; j >= 0 && j < lines.length; j += dir) {
      if (kinds[j] === 'blank') return null;
      if (kinds[j] !== 'meta') return kinds[j]!;
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'unknown') continue;
    const l = lines[i]!;
    const next = neighbour(i, 1);
    const prev = neighbour(i, -1);
    if (subheadingOf(l) && next === 'ingredient') kinds[i] = 'sub';
    else if (
      (prev === 'ingredient' || next === 'ingredient') &&
      l.text.length <= 60 &&
      !endsWithSentence(l.text, lang)
    )
      kinds[i] = 'ingredient';
  }
  let group: string | null = null;
  let seenStep = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const k = kinds[i]!;
    if (k === 'sub') group = subheadingOf(l);
    else if (k === 'ingredient' && !seenStep) ingredientsOut.push({ line: l, group });
    else if (
      k === 'step' ||
      (k === 'ingredient' && seenStep) ||
      (k === 'unknown' && seenStep) ||
      (k === 'blank' && seenStep)
    ) {
      seenStep = true;
      stepsOut.push(l);
    } else if (k === 'unknown') notes.push(l.raw);
  }
}
