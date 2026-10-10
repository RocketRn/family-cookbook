import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser, type Tx } from '../db/tx.js';
import { AppError, notFound } from '../errors.js';
import { mediaView, type MediaRow, type MediaView } from '../media/repo.js';
import { NOTE_MAX } from '../notify/templates.js';
import type { ObjectStorage } from '../storage/storage.js';

/**
 * BE-10 (PRD 2.4 steps 12-14, 3.2 reactions, 3.3; D-048): reactions and "I cooked it".
 *
 * - Anyone who may read a recipe as the author or a member of its book may react; someone who
 *   holds only its link sees the counts (?share_token=) but may not react (owner, Sprint 6).
 *   Emotions and "I'll cook it again" are one each (tapping again answers the same one; DELETE
 *   removes it).
 *   "I cooked it" can be marked any number of times, with an optional photo and up to 500
 *   characters for the author. "My version" stays hidden until stage 2.
 * - Counts are for everyone who may read the recipe. The photo and words of "I cooked it" are for
 *   the author; each cook also sees their own.
 * - The message to the author is written by the database with the mark (migration 0009).
 */
export const REACTION_KINDS = [
  'heart',
  'yum',
  'fire',
  'idea',
  'curious',
  'cook_again',
  'cooked',
] as const;
type Kind = (typeof REACTION_KINDS)[number];
const ONCE = new Set<Kind>(['heart', 'yum', 'fire', 'idea', 'curious', 'cook_again']);
const COOKED_SHOWN = 20;

const idParams = z.object({ id: z.string().uuid() });
const query = z.object({
  share_token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,64}$/)
    .optional(),
});
const body = z
  .object({
    kind: z.enum(REACTION_KINDS),
    note: z.string().max(4000).nullish(),
    photo_media_id: z.string().uuid().nullish(),
    cook_session_id: z.string().uuid().nullish(),
  })
  .strict()
  .transform((b) => ({ ...b, note: b.note?.trim() || null }))
  .superRefine((b, ctx) => {
    if (b.kind !== 'cooked' && (b.note || b.photo_media_id || b.cook_session_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['kind'],
        message: 'a photo, words and a cooking session belong to "cooked" only',
      });
    }
    if (b.note && [...b.note].length > NOTE_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: `at most ${NOTE_MAX} characters`,
      });
    }
  });

type Row = {
  id: string;
  kind: Kind;
  note: string | null;
  created_at: Date;
  photo: MediaRow | null;
};
export type ReactionView = {
  id: string;
  kind: Kind;
  note: string | null;
  photo: MediaView | null;
  created_at: string;
};
export type ReactionSummary = {
  counts: Record<Kind, number>;
  /** The caller's own: the id of each one-of reaction (or null), and how often they cooked it. */
  mine: Record<Exclude<Kind, 'cooked'>, string | null> & { cooked: number };
  /** "I cooked it" with photo and words, newest first: all of them for the author, else your own. */
  cooked: Array<{
    id: string;
    cook_name: string | null;
    note: string | null;
    photo: MediaView | null;
    created_at: string;
    mine: boolean;
  }>;
};

const badRequest = (message: string) => new AppError(400, 'VALIDATION_ERROR', message);
const recipeNotFound = () => notFound('Recipe not found');

/** A reaction with its photo's row (read through row-level security); `extra` adds columns. */
const selectRow = (extra = '') => `SELECT x.id, x.kind, x.note, x.created_at${extra},
         CASE WHEN m.id IS NULL THEN NULL
              ELSE json_build_object('id', m.id, 'owner_id', m.owner_id, 'storage_key', m.storage_key,
                                     'width', m.width, 'height', m.height) END AS photo
    FROM reactions x LEFT JOIN media m ON m.id = x.photo_media_id`;

async function photoView(files: ObjectStorage, m: MediaRow | null): Promise<MediaView | null> {
  return m ? mediaView(files, m) : null;
}

async function reactionView(files: ObjectStorage, r: Row): Promise<ReactionView> {
  return {
    id: r.id,
    kind: r.kind,
    note: r.note,
    photo: await photoView(files, r.photo),
    created_at: r.created_at.toISOString(),
  };
}

export async function reactionSummary(
  tx: Tx,
  files: ObjectStorage,
  recipeId: string,
): Promise<ReactionSummary> {
  const counts = Object.fromEntries(REACTION_KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  const c = await tx.query<{ kind: string; n: string }>('SELECT kind, n FROM reaction_counts($1)', [
    recipeId,
  ]);
  for (const r of c.rows) if (r.kind in counts) counts[r.kind as Kind] = Number(r.n);

  const mine = {
    heart: null,
    yum: null,
    fire: null,
    idea: null,
    curious: null,
    cook_again: null,
    cooked: 0,
  } as ReactionSummary['mine'];
  const own = await tx.query<{ id: string; kind: Kind }>(
    'SELECT id, kind FROM reactions WHERE recipe_id = $1 AND user_id = app_user_id()',
    [recipeId],
  );
  for (const r of own.rows) {
    if (r.kind === 'cooked') mine.cooked++;
    else if (ONCE.has(r.kind)) mine[r.kind as Exclude<Kind, 'cooked'>] = r.id;
  }

  // Row-level security: the author sees every mark on their recipe, anyone else only their own.
  const cooked = await tx.query<Row & { mine: boolean; cook_name: string | null }>(
    `${selectRow(', x.user_id = app_user_id() AS mine, cooked_by_name(x.id) AS cook_name')}
      WHERE x.recipe_id = $1 AND x.kind = 'cooked'
      ORDER BY x.created_at DESC, x.id
      LIMIT ${COOKED_SHOWN}`,
    [recipeId],
  );
  return {
    counts,
    mine,
    cooked: await Promise.all(
      cooked.rows.map(async (r) => ({
        id: r.id,
        cook_name: r.cook_name,
        note: r.note,
        photo: await photoView(files, r.photo),
        created_at: r.created_at.toISOString(),
        mine: r.mine,
      })),
    ),
  };
}

export function registerReactions(app: FastifyInstance, db: Db, files: ObjectStorage): void {
  const visible = async (tx: Tx, recipeId: string) => {
    const r = await tx.query('SELECT 1 FROM recipes WHERE id = $1', [recipeId]);
    if (!r.rowCount) throw recipeNotFound();
  };

  app.get('/recipes/:id/reactions', async (req) => {
    const user = currentUser(req);
    const { id } = idParams.parse(req.params);
    const { share_token } = query.parse(req.query);
    return withUser(db, { userId: user.id, shareToken: share_token }, async (tx) => {
      await visible(tx, id);
      return reactionSummary(tx, files, id);
    });
  });

  // Owner's Sprint 6 answer 2: someone holding only the link may not react (yet); the link's token
  // is not used here, so such a recipe is "not found" for them.
  app.post('/recipes/:id/reactions', async (req, reply) => {
    const user = currentUser(req);
    const { id } = idParams.parse(req.params);
    query.parse(req.query);
    const b = body.parse(req.body);
    const out = await withUser(db, { userId: user.id }, async (tx) => {
      await visible(tx, id);
      if (b.photo_media_id) {
        const m = await tx.query('SELECT 1 FROM media WHERE id = $1 AND owner_id = app_user_id()', [
          b.photo_media_id,
        ]);
        if (!m.rowCount) throw badRequest('photo_media_id: only a photo you uploaded');
      }
      if (b.cook_session_id) {
        const s = await tx.query(
          'SELECT 1 FROM cook_sessions WHERE id = $1 AND user_id = app_user_id() AND recipe_id = $2',
          [b.cook_session_id, id],
        );
        if (!s.rowCount) throw badRequest('cook_session_id: only your own session of this recipe');
      }
      const insert = await tx.query<{ id: string }>(
        `INSERT INTO reactions (recipe_id, user_id, kind, note, photo_media_id, cook_session_id)
         VALUES ($1, app_user_id(), $2, $3, $4, $5)
         ${ONCE.has(b.kind) ? "ON CONFLICT (recipe_id, user_id, kind) WHERE kind NOT IN ('cooked', 'my_version') DO NOTHING" : ''}
         RETURNING id`,
        [id, b.kind, b.note, b.photo_media_id ?? null, b.cook_session_id ?? null],
      );
      const created = !!insert.rowCount;
      const row = await tx.query<Row>(
        created
          ? `${selectRow()} WHERE x.id = $1`
          : `${selectRow()} WHERE x.recipe_id = $1 AND x.user_id = app_user_id() AND x.kind = $2`,
        created ? [insert.rows[0]!.id] : [id, b.kind],
      );
      return {
        created,
        reaction: await reactionView(files, row.rows[0]!),
        summary: await reactionSummary(tx, files, id),
      };
    });
    return reply
      .status(out.created ? 201 : 200)
      .send({ reaction: out.reaction, summary: out.summary });
  });

  app.delete('/reactions/:id', async (req, reply) => {
    const user = currentUser(req);
    const { id } = idParams.parse(req.params);
    const gone = await withUser(db, { userId: user.id }, (tx) =>
      tx.query('DELETE FROM reactions WHERE id = $1 AND user_id = app_user_id()', [id]),
    );
    if (!gone.rowCount) throw notFound('Reaction not found');
    return reply.status(204).send();
  });
}
