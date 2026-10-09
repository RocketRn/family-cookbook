import { DURATION_UNITS } from './dictionaries.js';
import { normalizeChars, trimEndChars } from './normalize.js';
import type { ParsedTimer } from './types.js';

const UNIT_ALT = DURATION_UNITS.map(([u]) => u).join('|');
/** Linear: starts only at the beginning of a number (lookbehind), bounded digits and spaces. */
const DURATION = new RegExp(
  `(?<![\\p{L}\\d.])(\\d{1,4}(?:[.,]\\d{1,2})?)(?: {0,2}- {0,2}(\\d{1,4}(?:[.,]\\d{1,2})?))? {0,2}(${UNIT_ALT})\\.?(?!\\p{L})`,
  'giu',
);
const SECONDS = new Map(DURATION_UNITS.map(([u, s]) => [u, s]));
/** What may stand between "1 ч" and "20 мин" for them to be one duration. */
const JOIN = /^(?: {1,3}| ?(?:и|і|та|and|och) )$/i;
const LABEL_MAX = 100;

const num = (s: string) => Number(s.replace(',', '.'));

type Hit = { start: number; end: number; sec: number; maxSec: number | null; unit: number };

/** Start and end of the sentence (or clause) around [start, end), at most 120 characters each way. */
function spanAround(text: string, start: number, end: number, stops: string): [number, number] {
  let a = start;
  while (a > 0 && start - a < 120 && !stops.includes(text[a - 1]!)) a--;
  let b = end;
  while (b < text.length && b - end < 120 && !stops.includes(text[b]!)) b++;
  return [a, b];
}

function labelOf(text: string, [a, b]: [number, number]): string {
  let label = trimEndChars(text.slice(a, b).trim(), ' .,;:!?');
  if (label.length > LABEL_MAX) {
    label = label.slice(0, LABEL_MAX);
    const space = label.lastIndexOf(' ');
    if (space > 40) label = label.slice(0, space);
  }
  return label;
}

/** Durations in step text become timer suggestions; a range keeps its lower bound (PRD 5.1.4). */
export function findDurations(input: string): ParsedTimer[] {
  const text = normalizeChars(input);
  const hits: Hit[] = [];
  for (const m of text.matchAll(DURATION)) {
    const per = SECONDS.get(m[3]!.toLowerCase())!;
    const lo = num(m[1]!) * per;
    const hi = m[2] !== undefined ? num(m[2]) * per : null;
    if (!(lo > 0) || lo > 7 * 86_400) continue;
    const hit: Hit = {
      start: m.index,
      end: m.index + m[0].length,
      sec: Math.round(lo),
      maxSec: hi !== null && hi > lo ? Math.round(hi) : null,
      unit: per,
    };
    const prev = hits[hits.length - 1];
    // "1 ч 20 мин": hours then minutes (or minutes then seconds) next to each other are one duration.
    if (
      prev &&
      prev.maxSec === null &&
      hit.maxSec === null &&
      hit.unit < prev.unit &&
      JOIN.test(text.slice(prev.end, hit.start))
    ) {
      prev.sec += hit.sec;
      prev.end = hit.end;
      prev.unit = hit.unit;
      continue;
    }
    hits.push(hit);
  }
  // One timer in a sentence is labelled with the sentence; several share it, so each gets its clause.
  const sentences = hits.map((h) => spanAround(text, h.start, h.end, '.!?;\n'));
  const perSentence = new Map<string, number>();
  for (const [a, b] of sentences)
    perSentence.set(`${a}:${b}`, (perSentence.get(`${a}:${b}`) ?? 0) + 1);
  return hits.map((h, i) => {
    const [a, b] = sentences[i]!;
    const span =
      perSentence.get(`${a}:${b}`) === 1
        ? sentences[i]!
        : spanAround(text, h.start, h.end, '.!?;,\n');
    return { durationSec: h.sec, maxSec: h.maxSec, label: labelOf(input, span) };
  });
}
