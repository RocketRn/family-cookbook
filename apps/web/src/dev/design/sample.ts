/**
 * Sample data for the UX-03 design screens (development only). Shaped like the import result of
 * PRD 2.2 step 5: parsed lines with a confidence (PRD 5.1.3) and the reasons that lowered it.
 */
export type Reason = 'p4' | 'no_unit' | 'bracket' | 'unparsed';
export type SampleLine = {
  id: string;
  section: string | null;
  raw: string;
  name: string;
  amount: string;
  unit: string;
  kind: 'exact' | 'range' | 'to_taste' | 'pinch' | 'unparsed';
  note?: string;
  confidence: number;
  reasons: Reason[];
};

export const ORIGINAL_TEXT = `Шарлотка

На 6 порций

Ингредиенты
Для теста:
яйца — 4 шт.
1 стакан сахара
мука — 1 (стакан с горкой, 160 г)
Для начинки:
4–5 яблок
корица по вкусу
ванилин

Приготовление
1. Взбейте яйца с сахаром до пышной пены, вмешайте муку.
2. Нарежьте яблоки, выложите в форму и залейте тестом. Видео: https://youtu.be/aqz-KE-bpKQ?t=30
3. Выпекайте 40 минут при 180 °C.`;

/** Confidence per PRD 5.1.3: 1.0 - 0.1 (P4) - 0.2 (no unit) - 0.2 (number in brackets) - 0.5 (P5). */
export const LINES: SampleLine[] = [
  {
    id: 'eggs',
    section: 'Для теста',
    raw: 'яйца — 4 шт.',
    name: 'яйца',
    amount: '4',
    unit: 'шт.',
    kind: 'exact',
    confidence: 0.9,
    reasons: ['p4'],
  },
  {
    id: 'sugar',
    section: 'Для теста',
    raw: '1 стакан сахара',
    name: 'сахара',
    amount: '1',
    unit: 'стакан',
    kind: 'exact',
    confidence: 1,
    reasons: [],
  },
  {
    id: 'flour',
    section: 'Для теста',
    raw: 'мука — 1 (стакан с горкой, 160 г)',
    name: 'мука',
    amount: '1',
    unit: '',
    kind: 'exact',
    note: 'стакан с горкой, 160 г',
    confidence: 0.5,
    reasons: ['p4', 'no_unit', 'bracket'],
  },
  {
    id: 'apples',
    section: 'Для начинки',
    raw: '4–5 яблок',
    name: 'яблок',
    amount: '4–5',
    unit: '',
    kind: 'range',
    confidence: 0.8,
    reasons: ['no_unit'],
  },
  {
    id: 'cinnamon',
    section: 'Для начинки',
    raw: 'корица по вкусу',
    name: 'корица',
    amount: '',
    unit: '',
    kind: 'to_taste',
    confidence: 1,
    reasons: [],
  },
  {
    id: 'vanilla',
    section: 'Для начинки',
    raw: 'ванилин',
    name: 'ванилин',
    amount: '',
    unit: '',
    kind: 'unparsed',
    confidence: 0.5,
    reasons: ['unparsed'],
  },
];

export type SampleStep = {
  id: string;
  text: string;
  /** Ingredient links suggested from mentions (PRD 5.1.4), portion 1 by default. */
  links: string[];
  timer?: { sec: number; label: string };
  video?: { id: string; start: number };
};

export const STEPS: SampleStep[] = [
  {
    id: 's1',
    text: 'Взбейте яйца с сахаром до пышной пены, вмешайте муку.',
    links: ['eggs', 'sugar', 'flour'],
  },
  {
    id: 's2',
    text: 'Нарежьте яблоки, выложите в форму и залейте тестом.',
    links: ['apples'],
    video: { id: 'aqz-KE-bpKQ', start: 30 },
  },
  {
    id: 's3',
    text: 'Выпекайте 40 минут при 180 °C.',
    links: [],
    timer: { sec: 2400, label: 'Выпекайте 40 минут' },
  },
];

export const LOW_CONFIDENCE = 0.7;
