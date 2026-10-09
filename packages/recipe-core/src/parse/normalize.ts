import type { Lang } from '../types.js';
import { parseYoutube } from '../youtube.js';

/**
 * PRD 5.1.1 stage 1, per line. Every pattern here is linear-time: bounded quantifiers, single
 * character classes, lookbehinds that pin a match to the start of a number (D-033).
 */
const SPACES = /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\t\f\v]/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const EMOJI = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu;
const FRACTIONS: Record<string, number> = {
  '½': 1 / 2,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅕': 1 / 5,
  '⅖': 2 / 5,
  '⅗': 3 / 5,
  '⅘': 4 / 5,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};
const GLYPHS = Object.keys(FRACTIONS).join('');
const GLYPH_NUMBER = new RegExp(`(?<![\\d.])(\\d{1,6})? ?([${GLYPHS}])`, 'g');
const MIXED_NUMBER = /(?<![\d./])(\d{1,6}) (\d{1,3})\/(\d{1,3})(?![\d/])/g;
const SIMPLE_FRACTION = /(?<![\d./])(\d{1,3})\/(\d{1,3})(?![\d/])/g;
const DECIMAL_COMMA = /(?<=\d),(?=\d)/g;
const THOUSANDS_COMMA = /(?<=\d),(?=\d{3}(?!\d))/g;
const BULLET = /^[-*•·▪◦‣+]{1,3} {1,3}/;
const NUMBERED = /^(\d{1,3})[.)] {1,3}(?=\S)/;
const STEP_WORD = /^(?:шаг|крок|step|steg) {0,3}\d{1,3} {0,3}[.:)]? {0,3}/i;
const URL = /https?:\/\/[^\s<>"]{1,2000}/g;
const VIDEO_LABEL = /\s*(?:видео|відео|video|ссылка|посилання|link|länk)\s*:?\s*$/i;

const fmt = (v: number) => String(Number(v.toFixed(6)));
export const collapse = (s: string) => s.replace(/\s{2,}/g, ' ').trim();

/** Numbers as one form: fractions and mixed numbers to decimals, decimal comma to a dot. */
export function normalizeNumbers(s: string, lang: Lang): string {
  let t = s.replace(GLYPH_NUMBER, (_m, whole: string | undefined, glyph: string) =>
    fmt((whole ? Number(whole) : 0) + FRACTIONS[glyph]!),
  );
  t = t.replace(MIXED_NUMBER, (m, w: string, n: string, d: string) =>
    Number(d) > 0 ? fmt(Number(w) + Number(n) / Number(d)) : m,
  );
  t = t.replace(SIMPLE_FRACTION, (m, n: string, d: string) =>
    Number(d) > 0 ? fmt(Number(n) / Number(d)) : m,
  );
  // "1,000 g" in English is a thousands separator; elsewhere a comma between digits is decimal.
  if (lang === 'en') t = t.replace(THOUSANDS_COMMA, '');
  return t.replace(DECIMAL_COMMA, '.');
}

/** Same length as the input (one character for one), so positions still point into the original. */
export const normalizeChars = (s: string) => s.replace(SPACES, ' ').replace(DASHES, '-');

export type LineInfo = {
  /** The line as written, trimmed, list marker removed, YouTube links removed. */
  raw: string;
  /** Normalized for parsing: spaces, dashes, emoji, numbers; collapsed. */
  text: string;
  marker: 'numbered' | 'step' | 'bullet' | null;
  videos: Array<{ youtubeId: string; startSec: number | null }>;
  blank: boolean;
};

export function readLine(original: string, lang: Lang): LineInfo {
  // `norm` has the same length as `orig` (one character for one), so a marker found in `norm`
  // is cut from `orig` at the same position: what people see keeps its own dashes and spaces.
  let orig = original;
  let norm = normalizeChars(original);
  const videos: LineInfo['videos'] = [];
  if (norm.includes('://')) {
    let removed = false;
    const strip = (s: string, collect: boolean) =>
      s.replace(URL, (url) => {
        const yt = parseYoutube(trimEndChars(url, '.,;)'));
        if (!yt) return url;
        if (collect) videos.push({ youtubeId: yt.id, startSec: yt.startSec });
        removed = true;
        return ' '.repeat(url.length);
      });
    norm = strip(norm, true);
    orig = strip(orig, false);
    if (removed) {
      const label = VIDEO_LABEL.exec(norm.trimEnd());
      if (label) {
        norm = norm.slice(0, label.index);
        orig = orig.slice(0, label.index);
      }
    }
  }
  const lead = norm.length - norm.trimStart().length;
  norm = norm.slice(lead).trimEnd();
  orig = orig.slice(lead, lead + norm.length);
  let marker: LineInfo['marker'] = null;
  const m = STEP_WORD.exec(norm) ?? NUMBERED.exec(norm) ?? BULLET.exec(norm);
  if (m) {
    marker = STEP_WORD.test(norm) ? 'step' : NUMBERED.test(norm) ? 'numbered' : 'bullet';
    norm = norm.slice(m[0].length);
    orig = orig.slice(m[0].length);
  }
  const raw = collapse(orig);
  const text = collapse(normalizeNumbers(norm.replace(EMOJI, ' '), lang));
  return { raw, text, marker, videos, blank: text === '' && videos.length === 0 };
}

/** Removes trailing `chars` with a loop: a regex like /[-\s]+$/ backtracks quadratically. */
export function trimEndChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1]!)) end--;
  return s.slice(0, end);
}

/** Lowercase, ё -> е: the form dictionary words are compared in. */
export const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
