#!/usr/bin/env node
// Sprint 2 demo "A recipe in the book": as the dev keeper (seed user 1), uploads two photos and
// publishes a complete recipe to the book through the real API, then prints where to open it.
// Needs the local stack: docker compose up -d, pnpm db:migrate, pnpm db:seed, pnpm dev.
//   node scripts/demo-recipe.mjs            (API at http://localhost:3000)
//   API_URL=http://localhost:3001 node scripts/demo-recipe.mjs
import { createRequire } from 'node:module';
import { devInitData } from './lib/dev-init-data.mjs';

const API = process.env.API_URL ?? 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
// sharp is a dependency of the API package; it draws the demo photos.
const sharp = createRequire(new URL('../apps/api/package.json', import.meta.url))('sharp');

async function call(method, path, body, isForm = false) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `tma ${devInitData('1')}`,
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  }).catch(() => {
    throw new Error(`The API is not running at ${API}. Start it with "pnpm dev".`);
  });
  const json = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json?.error)}`);
  return json;
}

async function photo(label, colors) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="54%" font-family="sans-serif" font-size="120" fill="white" text-anchor="middle">${label}</text>
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
  const form = new FormData();
  form.append('file', new Blob([jpeg], { type: 'image/jpeg' }), `${label}.jpg`);
  return call('POST', '/media', form, true);
}

const me = await call('GET', '/me');
console.log(`Signed in as ${me.first_name} (dev user 1).`);
const cover = await photo('Шарлотка', ['#c9772b', '#7a3b12']);
const stepPhoto = await photo('Тесто', ['#e8c27a', '#b5832f']);
console.log(`Uploaded 2 photos (${cover.width}x${cover.height}, stored as JPEG without metadata).`);

const recipe = await call('POST', '/recipes', {
  title: 'Шарлотка (демо)',
  servings: 6,
  difficulty: 'easy',
  prep_min: 15,
  cook_min: 40,
  language: 'ru',
  visibility: 'book',
  status: 'published',
  tags: ['baking', 'dessert', 'семейное'],
  cover_media_id: cover.id,
  author_notes: 'Яблоки лучше кислые: антоновка или симиренко.',
  ingredients: [
    {
      ref: 'eggs',
      group_label: 'Для теста',
      name: 'Яйца',
      qty_kind: 'exact',
      amount_min: 4,
      unit_code: 'pcs',
      round_class: 'whole_item',
      min_piece: 1,
    },
    {
      ref: 'sugar',
      group_label: 'Для теста',
      name: 'Сахар',
      qty_kind: 'exact',
      amount_min: 1,
      unit_code: 'cup',
    },
    {
      ref: 'flour',
      group_label: 'Для теста',
      name: 'Мука',
      qty_kind: 'exact',
      amount_min: 1,
      unit_code: 'cup',
    },
    {
      ref: 'apples',
      group_label: 'Для начинки',
      name: 'Яблоки',
      qty_kind: 'range',
      amount_min: 4,
      amount_max: 5,
      unit_code: 'pcs',
      round_class: 'whole_item',
      min_piece: 0.5,
    },
    {
      ref: 'cinnamon',
      group_label: 'Для начинки',
      name: 'Корица',
      qty_kind: 'to_taste',
      round_class: 'spice_item',
      optional: true,
    },
  ],
  videos: [
    { ref: 'v', youtube_id: 'aqz-KE-bpKQ', title: 'Пример встроенного видео (Big Buck Bunny)' },
  ],
  steps: [
    {
      title: 'Тесто',
      body: 'Взбейте яйца ({ing:eggs}) с {ing:sugar} сахара до пышной пены, затем вмешайте {ing:flour} муки.',
      photo_media_id: stepPhoto.id,
      ingredients: [{ ref: 'eggs' }, { ref: 'sugar' }, { ref: 'flour' }],
    },
    {
      body: 'Нарежьте яблоки ({ing:apples}), выложите в форму, посыпьте корицей и залейте тестом.',
      ingredients: [{ ref: 'apples' }, { ref: 'cinnamon' }],
      video_ref: 'v',
      video_start_sec: 30,
    },
    {
      body: 'Выпекайте при 180 °C до золотистой корочки.',
      timers: [{ label: 'Духовка', duration_sec: 2400 }],
    },
  ],
});
console.log(`Published "${recipe.title}" (version ${recipe.version}) to the book.`);
console.log(
  `\nOpen it: ${WEB}/recipe/${recipe.id}\nOr open ${WEB} and tap the recipe in the book.`,
);
