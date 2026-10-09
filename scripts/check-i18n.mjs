#!/usr/bin/env node
// Key-completeness check for the web UI locales (run in CI via `pnpm i18n:check`).
// en is the reference. Plural keys (`foo_one`, `foo_few`, ...) are compared per language rules:
// ru and uk need one/few/many/other, en and sv need one/other (PRD 7.1: ICU plural forms).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/web/src/i18n/locales',
);
const langs = ['en', 'ru', 'uk', 'sv'];
const PLURALS = {
  en: ['one', 'other'],
  sv: ['one', 'other'],
  ru: ['one', 'few', 'many', 'other'],
  uk: ['one', 'few', 'many', 'other'],
};
const ALL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_meta') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

// "recipes_count_one" -> { base: "recipes_count", suffix: "one" }
function split(key) {
  const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  return m ? { base: m[1], suffix: m[2] } : { base: key, suffix: null };
}

function describe(flat) {
  const plain = new Set();
  const plural = new Map();
  for (const key of Object.keys(flat)) {
    const { base, suffix } = split(key);
    if (suffix) plural.set(base, [...(plural.get(base) ?? []), suffix]);
    else plain.add(key);
  }
  return { plain, plural };
}

const data = Object.fromEntries(
  langs.map((l) => [l, JSON.parse(readFileSync(path.join(dir, `${l}.json`), 'utf8'))]),
);
const ref = describe(flatten(data.en));
const problems = [];

for (const lang of langs) {
  const flat = flatten(data[lang]);
  const d = describe(flat);
  for (const k of ref.plain) if (!d.plain.has(k)) problems.push(`${lang}: missing key "${k}"`);
  for (const k of d.plain)
    if (!ref.plain.has(k)) problems.push(`${lang}: extra key "${k}" (not in en)`);
  for (const base of ref.plural.keys()) {
    const have = d.plural.get(base) ?? [];
    for (const s of PLURALS[lang])
      if (!have.includes(s)) problems.push(`${lang}: plural "${base}" is missing form "_${s}"`);
    for (const s of have)
      if (!PLURALS[lang].includes(s) && ALL_SUFFIXES.includes(s))
        problems.push(`${lang}: plural "${base}" has unused form "_${s}"`);
  }
  for (const base of d.plural.keys())
    if (!ref.plural.has(base)) problems.push(`${lang}: extra plural "${base}" (not in en)`);
  for (const [k, v] of Object.entries(flat))
    if (typeof v !== 'string' || v.trim() === '') problems.push(`${lang}: "${k}" is empty`);

  // Interpolation placeholders must match the reference language.
  const enFlat = flatten(data.en);
  for (const [k, v] of Object.entries(flat)) {
    const { base, suffix } = split(k);
    const refKey = enFlat[k] !== undefined ? k : suffix ? `${base}_other` : k;
    const refVal = enFlat[refKey];
    if (typeof refVal !== 'string' || typeof v !== 'string') continue;
    const vars = (s) =>
      [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
        .map((m) => m[1])
        .sort()
        .join(',');
    if (vars(refVal) !== vars(v))
      problems.push(
        `${lang}: "${k}" placeholders differ from en ({{${vars(v)}}} vs {{${vars(refVal)}}})`,
      );
  }
}

for (const lang of ['uk', 'sv']) {
  if (data[lang]._meta?.status !== 'needs-native-review')
    problems.push(`${lang}: _meta.status "needs-native-review" marker is missing`);
}

if (problems.length) {
  console.error(`i18n check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(
  `i18n check passed: ${langs.length} locales, ${ref.plain.size} keys, ${ref.plural.size} plural groups.`,
);
