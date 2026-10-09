import type { Db } from '../db/pool.js';
import { withSystem } from '../db/tx.js';
import type { ObjectStorage } from '../storage/storage.js';
import { objectKeys } from './repo.js';

/**
 * PRD 6.2 BE-05: removes uploads that no recipe or step uses, once they are old enough that nobody
 * is still editing (default 24 h). Rows go first; a leftover file is harmless, a row without a
 * file would be a broken photo. Safe in several workers at once: the DELETE locks its rows, so a
 * concurrent run waits and then finds them gone. (No FOR UPDATE: the system role has no UPDATE right.)
 */
export async function cleanupOrphanMedia(
  db: Db,
  storage: ObjectStorage,
  opts: { olderThanHours?: number; limit?: number } = {},
): Promise<number> {
  const storageKeys = await withSystem(db, async (tx) => {
    const r = await tx.query<{ storage_key: string }>(
      `WITH doomed AS (
         SELECT m.id FROM media m
          WHERE m.created_at < now() - make_interval(hours => $1)
            AND NOT EXISTS (SELECT 1 FROM recipes r WHERE r.cover_media_id = m.id)
            AND NOT EXISTS (SELECT 1 FROM recipe_steps s WHERE s.photo_media_id = m.id)
          ORDER BY m.created_at
          LIMIT $2)
       DELETE FROM media m USING doomed d WHERE m.id = d.id
       RETURNING m.storage_key`,
      [opts.olderThanHours ?? 24, opts.limit ?? 200],
    );
    return r.rows.map((x) => x.storage_key);
  });
  await storage.delete(storageKeys.flatMap((k) => Object.values(objectKeys(k))));
  return storageKeys.length;
}
