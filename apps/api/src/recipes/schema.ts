import { z } from 'zod';

/** PRD 7.1 data limits for one recipe. */
export const LIMITS = {
  ingredients: 100,
  steps: 60,
  videos: 10,
  tags: 20,
  timersPerStep: 10,
  photos: 20,
} as const;

const uuid = z.string().uuid();
/** Client-side reference of a line inside one request (an existing id may be used as the ref). */
const ref = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const amount = z.number().finite().min(0).max(99_999_999);
const minutes = z.number().int().min(0).max(10_080);

export const QTY_KINDS = ['exact', 'range', 'to_taste', 'pinch', 'unparsed'] as const;
export const ROUND_CLASSES = ['continuous', 'whole_item', 'spice_item'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const VISIBILITIES = ['private', 'book', 'link'] as const;
export const STATUSES = ['draft', 'published', 'archived'] as const;

export const ingredientInput = z
  .object({
    ref,
    id: uuid.optional(),
    group_label: z.string().trim().max(100).nullish(),
    name: z.string().trim().min(1).max(200),
    qty_kind: z.enum(QTY_KINDS),
    amount_min: amount.nullish(),
    amount_max: amount.nullish(),
    unit_code: z.string().max(16).nullish(),
    unit_raw: z.string().trim().max(50).nullish(),
    round_class: z.enum(ROUND_CLASSES).optional(),
    min_piece: z.number().positive().max(99).nullish(),
    optional: z.boolean().optional(),
    note: z.string().trim().max(500).nullish(),
    raw_line: z.string().max(500).nullish(),
    parse_confidence: z.number().min(0).max(1).nullish(),
  })
  .strict();

export const videoInput = z
  .object({
    ref,
    id: uuid.optional(),
    youtube_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'must be an 11-character YouTube video id'),
    title: z.string().trim().max(200).nullish(),
  })
  .strict();

export const stepInput = z
  .object({
    id: uuid.optional(),
    title: z.string().trim().max(200).nullish(),
    body: z.string().max(5000).default(''),
    photo_media_id: uuid.nullish(),
    video_ref: ref.nullish(),
    video_start_sec: z.number().int().min(0).max(86_400).nullish(),
    ingredients: z
      .array(z.object({ ref, portion_fraction: z.number().gt(0).max(1).default(1) }).strict())
      .max(LIMITS.ingredients)
      .default([]),
    timers: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(100),
            duration_sec: z.number().int().min(1).max(86_400),
          })
          .strict(),
      )
      .max(LIMITS.timersPerStep)
      .default([]),
  })
  .strict();

const meta = {
  title: z.string().trim().min(1).max(200),
  servings: z.number().gt(0).max(9999),
  difficulty: z.enum(DIFFICULTIES).nullable(),
  prep_min: minutes.nullable(),
  cook_min: minutes.nullable(),
  language: z
    .string()
    .regex(/^[a-z]{2}$/)
    .nullable(),
  author_notes: z.string().max(5000).nullable(),
  visibility: z.enum(VISIBILITIES),
  status: z.enum(STATUSES),
  tags: z.array(z.string().trim().min(1).max(50)).max(LIMITS.tags),
  cover_media_id: uuid.nullable(),
};

const content = {
  ingredients: z.array(ingredientInput).max(LIMITS.ingredients),
  steps: z.array(stepInput).max(LIMITS.steps),
  videos: z.array(videoInput).max(LIMITS.videos),
};

export const createRecipeBody = z
  .object({
    title: meta.title,
    servings: meta.servings.default(4),
    difficulty: meta.difficulty.default(null),
    prep_min: meta.prep_min.default(null),
    cook_min: meta.cook_min.default(null),
    language: meta.language.default(null),
    author_notes: meta.author_notes.default(null),
    visibility: meta.visibility.default('private'),
    status: meta.status.default('draft'),
    tags: meta.tags.default([]),
    cover_media_id: meta.cover_media_id.default(null),
    ingredients: content.ingredients.default([]),
    steps: content.steps.default([]),
    videos: content.videos.default([]),
  })
  .strict();

export const patchRecipeBody = z
  .object({
    title: meta.title.optional(),
    servings: meta.servings.optional(),
    difficulty: meta.difficulty.optional(),
    prep_min: meta.prep_min.optional(),
    cook_min: meta.cook_min.optional(),
    language: meta.language.optional(),
    author_notes: meta.author_notes.optional(),
    visibility: meta.visibility.optional(),
    status: meta.status.optional(),
    tags: meta.tags.optional(),
    cover_media_id: meta.cover_media_id.optional(),
    ingredients: content.ingredients.optional(),
    steps: content.steps.optional(),
    videos: content.videos.optional(),
  })
  .strict()
  .refine(
    (b) =>
      [b.ingredients, b.steps, b.videos].every((x) => x === undefined) ||
      [b.ingredients, b.steps].every((x) => x !== undefined),
    {
      message:
        'ingredients and steps are replaced together: send both (and videos, or [] for none)',
    },
  );

export type CreateRecipeBody = z.infer<typeof createRecipeBody>;
export type PatchRecipeBody = z.infer<typeof patchRecipeBody>;
export type IngredientInput = z.infer<typeof ingredientInput>;
export type StepInput = z.infer<typeof stepInput>;
export type VideoInput = z.infer<typeof videoInput>;

export const listQuery = z
  .object({
    scope: z.enum(['book', 'mine']).default('book'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export const recipeParams = z.object({ id: uuid }).strict();
export const shareParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }).strict();
