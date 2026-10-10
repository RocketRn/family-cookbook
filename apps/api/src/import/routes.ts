import type { Lang, ParsedRecipe } from '@cookbook/recipe-core';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser, type Tx } from '../db/tx.js';
import { notFound } from '../errors.js';
import { noExistingIds, planContent } from '../recipes/content.js';
import { findRecipe, insertRecipe, writeContent } from '../recipes/repo.js';
import { view } from '../recipes/routes.js';
import { createRecipeBody, LIMITS } from '../recipes/schema.js';
import type { ObjectStorage } from '../storage/storage.js';
import type { ImportParser } from './parserPool.js';

const idParam = z.object({ id: z.string().uuid() });

/** PRD 7.1: import text <= 20,000 characters. */
export const IMPORT_MAX_CHARS = 20_000;
const LANGS = ['ru', 'uk', 'en', 'sv'] as const;
const importBody = z
  .object({
    text: z
      .string()
      .max(IMPORT_MAX_CHARS, `at most ${IMPORT_MAX_CHARS} characters`)
      .refine((t) => t.trim().length > 0, 'the text is empty'),
    ui_lang: z.enum(LANGS),
  })
  .strict();

/** When the text has no title line. */
const UNTITLED: Record<Lang, string> = {
  ru: 'Новый рецепт',
  uk: 'Новий рецепт',
  en: 'New recipe',
  sv: 'Nytt recept',
};

const cut = (s: string | null, max: number) =>
  s === null ? null : s.length > max ? s.slice(0, max) : s;
const minutes = (m: number | null) => (m !== null && m <= 10_080 ? m : null);

/**
 * The parse as a recipe body (the same validation as POST /recipes). Every value is cut to the
 * API limits; the original text is kept in raw_text whatever happens. An ingredient a step mentions
 * is linked with portion 1, or with equal shares when several steps mention it (sum <= 1).
 */
export function draftFrom(p: ParsedRecipe, uiLang: Lang) {
  const mentions = new Map<number, number>();
  for (const s of p.steps) for (const i of s.links) mentions.set(i, (mentions.get(i) ?? 0) + 1);
  const share = (i: number) => Math.floor(100 / (mentions.get(i) ?? 1)) / 100;
  const videos = p.videos.slice(0, LIMITS.videos);
  return createRecipeBody.parse({
    title: cut(p.title?.trim() || UNTITLED[uiLang], 200),
    servings: p.servings ?? 4,
    prep_min: minutes(p.prepMin),
    cook_min: minutes(p.cookMin),
    language: p.language,
    author_notes: cut(p.notes, 5000),
    status: 'draft',
    visibility: 'private',
    ingredients: p.ingredients.map((i, n) => ({
      ref: `i${n}`,
      group_label: cut(i.groupLabel, 100),
      name: cut(i.name, 200),
      qty_kind: i.qtyKind,
      amount_min: i.amountMin,
      amount_max: i.qtyKind === 'range' ? i.amountMax : null,
      unit_code: i.unitCode,
      unit_raw: cut(i.unitRaw, 50),
      round_class: i.roundClass,
      min_piece: i.minPiece,
      note: cut(i.note, 500),
      raw_line: cut(i.raw, 500),
      parse_confidence: i.confidence,
    })),
    videos: videos.map((v, n) => ({ ref: `v${n}`, youtube_id: v.youtubeId })),
    steps: p.steps.map((s) => ({
      body: cut(s.text, 5000),
      ingredients: s.links.map((i) => ({ ref: `i${i}`, portion_fraction: share(i) })),
      timers: s.timers.slice(0, LIMITS.timersPerStep).map((t) => ({
        label: cut(t.label || '⏱', 100),
        duration_sec: Math.min(t.durationSec, 86_400),
      })),
      video_ref: s.video !== null && s.video < videos.length ? `v${s.video}` : null,
      video_start_sec:
        s.video !== null && s.video < videos.length ? videos[s.video]!.startSec : null,
    })),
  });
}

/** What the review screen needs besides the recipe (kept in source_ref, D-054). */
export type ImportNotes = { warnings: string[]; reasons: string[][] };

/**
 * The parse becomes a private draft of `authorId` (PRD 2.2 step 5), with the original text in
 * raw_text and the review notes in source_ref, so "Check the recipe" works on any device and for a
 * recipe forwarded to the bot. Runs as the author (row-level security). Returns the draft's id.
 */
export async function createImportedDraft(
  tx: Tx,
  args: {
    authorId: string;
    text: string;
    parsed: ParsedRecipe;
    uiLang: Lang;
    sourceType: 'paste' | 'bot_forward';
    sourceRef?: Record<string, unknown>;
  },
): Promise<{ id: string; title: string }> {
  const draft = draftFrom(args.parsed, args.uiLang);
  const notes: ImportNotes = {
    warnings: args.parsed.warnings,
    reasons: args.parsed.ingredients.map((i) => i.reasons),
  };
  const id = await insertRecipe(tx, {
    authorId: args.authorId,
    bookId: null,
    title: draft.title,
    status: 'draft',
    visibility: 'private',
    servings: draft.servings,
    difficulty: null,
    prepMin: draft.prep_min,
    cookMin: draft.cook_min,
    language: draft.language,
    authorNotes: draft.author_notes,
    coverMediaId: null,
    sourceType: args.sourceType,
    rawText: args.text,
    sourceRef: { ...args.sourceRef, import: notes },
  });
  await writeContent(tx, id, planContent(draft, noExistingIds()));
  return { id, title: draft.title };
}

/**
 * PRD 2.2 / 4.9 POST /recipes/import: parse pasted text into a private draft (source "paste", the
 * original text kept). The response adds what the review needs: confidence and reasons per line,
 * and the parser's warnings. Timers and links found in the text are already in the draft.
 * GET /recipes/:id/import gives the same notes later, to the author, while the draft is as the
 * import made it (never saved since): for "Check the recipe" from the bot (D-054) or from another device.
 */
export function registerImport(
  app: FastifyInstance,
  db: Db,
  storage: ObjectStorage,
  parser: ImportParser,
  limit: preHandlerAsyncHookHandler,
): void {
  app.post('/recipes/import', { preHandler: limit }, async (req, reply) => {
    const user = currentUser(req);
    const body = importBody.parse(req.body);
    const parsed = await parser.parse(body.text, body.ui_lang);
    const recipe = await withUser(db, { userId: user.id }, async (tx) => {
      const { id } = await createImportedDraft(tx, {
        authorId: user.id,
        text: body.text,
        parsed,
        uiLang: body.ui_lang,
        sourceType: 'paste',
      });
      return view(tx, storage, (await findRecipe(tx, id))!, user.id);
    });
    return reply.status(201).send({
      recipe,
      import: {
        lines: recipe.ingredients.map((ing, n) => ({
          ingredient_id: ing.id,
          confidence: parsed.ingredients[n]?.confidence ?? null,
          reasons: parsed.ingredients[n]?.reasons ?? [],
        })),
        warnings: parsed.warnings,
      },
    });
  });

  app.get('/recipes/:id/import', async (req) => {
    const user = currentUser(req);
    const { id } = idParam.parse(req.params);
    const notes = await withUser(db, { userId: user.id }, async (tx) => {
      const r = await tx.query<{ raw_text: string; notes: ImportNotes | null }>(
        `SELECT raw_text, source_ref -> 'import' AS notes FROM recipes
          WHERE id = $1 AND author_id = app_user_id() AND deleted_at IS NULL AND updated_at = created_at
            AND source_type IN ('paste', 'bot_forward') AND raw_text IS NOT NULL`,
        [id],
      );
      const row = r.rows[0];
      if (!row?.notes) return null;
      const ids = await tx.query<{ id: string }>(
        'SELECT id FROM recipe_ingredients WHERE recipe_id = $1 ORDER BY position',
        [id],
      );
      return {
        original: row.raw_text,
        warnings: row.notes.warnings ?? [],
        reasons: Object.fromEntries(ids.rows.map((x, n) => [x.id, row.notes!.reasons?.[n] ?? []])),
      };
    });
    if (!notes) throw notFound('No import to check for this recipe');
    return notes;
  });
}
