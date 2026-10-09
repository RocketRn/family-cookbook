import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import { randomUUID } from 'node:crypto';
import { currentUser } from '../auth/plugin.js';
import type { Db } from '../db/pool.js';
import { withUser } from '../db/tx.js';
import { AppError } from '../errors.js';
import type { ObjectStorage } from '../storage/storage.js';
import { MAX_UPLOAD_BYTES, processImage } from './process.js';
import { insertMedia, mediaView, objectKeys } from './repo.js';

const tooLarge = () => new AppError(413, 'IMAGE_TOO_LARGE', 'A photo can be at most 10 MB');

/** PRD 4.9 POST /media: one image in the multipart field "file". */
export function registerMedia(
  app: FastifyInstance,
  db: Db,
  storage: ObjectStorage,
  uploadLimit: preHandlerAsyncHookHandler,
): void {
  app.post('/media', { preHandler: uploadLimit }, async (req, reply) => {
    const user = currentUser(req);
    if (!req.isMultipart())
      throw new AppError(400, 'VALIDATION_ERROR', 'Send the photo as multipart/form-data');
    let body: Buffer;
    try {
      const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
      if (!file || file.fieldname !== 'file') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Send one photo in the "file" field');
      }
      body = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge();
      throw err;
    }

    // CPU-heavy work happens outside any database transaction.
    const img = await processImage(body);
    const id = randomUUID();
    const storageKey = `media/${id}`;
    const keys = objectKeys(storageKey);
    await storage.put(keys.full, img.full, 'image/jpeg');
    await storage.put(keys.thumb, img.thumb, 'image/jpeg');
    const row = {
      id,
      owner_id: user.id,
      storage_key: storageKey,
      width: img.width,
      height: img.height,
    };
    try {
      await withUser(db, { userId: user.id }, (tx) =>
        insertMedia(tx, { ...row, bytes: img.full.length, sha256: img.sha256 }),
      );
    } catch (err) {
      await storage.delete([keys.full, keys.thumb]).catch(() => undefined);
      throw err;
    }
    return reply.status(201).send(await mediaView(storage, row));
  });
}
