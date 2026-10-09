import type { Tx } from '../db/tx.js';
import type { ObjectStorage } from '../storage/storage.js';

export type MediaRow = {
  id: string;
  owner_id: string;
  storage_key: string;
  width: number;
  height: number;
};

export const objectKeys = (storageKey: string) => ({
  full: `${storageKey}/full.jpg`,
  thumb: `${storageKey}/thumb.jpg`,
});

export async function insertMedia(
  tx: Tx,
  m: MediaRow & { bytes: number; sha256: string },
): Promise<void> {
  await tx.query(
    `INSERT INTO media (id, owner_id, storage_key, mime, width, height, bytes, sha256)
     VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6, $7)`,
    [m.id, m.owner_id, m.storage_key, m.width, m.height, m.bytes, m.sha256],
  );
}

/** Reads through RLS: only media the caller owns or can see through a recipe. */
export async function loadMedia(
  tx: Tx,
  ids: Array<string | null | undefined>,
): Promise<Map<string, MediaRow>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const r = await tx.query<MediaRow>(
    'SELECT id, owner_id, storage_key, width, height FROM media WHERE id = ANY($1::uuid[])',
    [wanted],
  );
  return new Map(r.rows.map((m) => [m.id, m]));
}

/** Media ids from `ids` that the user does not own (attaching them is refused). */
export async function notOwned(tx: Tx, userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const owned = await tx.query<{ id: string }>(
    'SELECT id FROM media WHERE id = ANY($1::uuid[]) AND owner_id = $2',
    [[...new Set(ids)], userId],
  );
  const ok = new Set(owned.rows.map((r) => r.id));
  return ids.filter((id) => !ok.has(id));
}

export type MediaView = {
  id: string;
  width: number;
  height: number;
  url: string;
  thumb_url: string;
};

export async function mediaView(storage: ObjectStorage, m: MediaRow): Promise<MediaView> {
  const k = objectKeys(m.storage_key);
  return {
    id: m.id,
    width: m.width,
    height: m.height,
    url: await storage.url(k.full),
    thumb_url: await storage.url(k.thumb),
  };
}
