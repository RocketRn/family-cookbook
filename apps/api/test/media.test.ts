import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/pool.js';
import { withUser } from '../src/db/tx.js';
import { cleanupOrphanMedia } from '../src/media/cleanup.js';
import { MemoryStorage } from '../src/storage/storage.js';
import { adminPool, authHeader, resetData, testApp, testPool } from './helpers/db.js';
import { gif, heicLike, hugePng, jpegWithExif, multipart, png, webp } from './helpers/images.js';
import { fullRecipe } from './helpers/recipes.js';

let db: Db;
let admin: Db;
let app: FastifyInstance;
let storage: MemoryStorage;
const AUTHOR = 8201;
const MEMBER = 8202;
const OUTSIDER = 8203;

beforeAll(async () => {
  db = testPool();
  admin = adminPool();
  storage = new MemoryStorage();
  app = await testApp(db, { storage });
});
afterAll(async () => {
  await app.close();
  await db.end();
  await admin.end();
});
beforeEach(async () => {
  await resetData(admin);
  storage.objects.clear();
  const book = (await call('POST', '/books', AUTHOR, { title: 'B' })).json();
  await call('POST', '/books/join', MEMBER, { invite_code: book.invite_code });
  await call('POST', '/books', OUTSIDER, { title: 'Other' });
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, tg: number, payload?: object) =>
  app.inject({ method, url, headers: authHeader(tg), ...(payload ? { payload } : {}) });
const upload = (tg: number, buf: Buffer, opts: Parameters<typeof multipart>[1] = {}) => {
  const m = multipart(buf, opts);
  return app.inject({
    method: 'POST',
    url: '/media',
    headers: { ...authHeader(tg), ...m.headers },
    payload: m.payload,
  });
};
const uploadOk = async (tg: number, buf?: Buffer) => {
  const res = await upload(tg, buf ?? (await png()));
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as {
    id: string;
    width: number;
    height: number;
    url: string;
    thumb_url: string;
  };
};

describe('POST /media (BE-05)', () => {
  it('removes EXIF, applies the orientation first, resizes, stores full + thumbnail as JPEG', async () => {
    const input = await jpegWithExif(400, 200);
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the input really carries EXIF
    const m = await uploadOk(AUTHOR, input);
    expect([m.width, m.height]).toEqual([200, 400]); // orientation 6 = stored sideways
    expect(m.url).toContain(`media/${m.id}/full.jpg`);
    expect(m.thumb_url).toContain(`media/${m.id}/thumb.jpg`);

    const full = storage.objects.get(`media/${m.id}/full.jpg`)!;
    const meta = await sharp(full.body).metadata();
    expect(full.contentType).toBe('image/jpeg');
    expect(meta).toMatchObject({ format: 'jpeg', width: 200, height: 400 });
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(full.body.includes(Buffer.from('Private family photo'))).toBe(false);

    const row = (await admin.query('SELECT * FROM media WHERE id = $1', [m.id])).rows[0];
    expect(row).toMatchObject({
      mime: 'image/jpeg',
      width: 200,
      height: 400,
      bytes: full.body.length,
    });
    expect(row.sha256).toBe(createHash('sha256').update(full.body).digest('hex'));
  });

  it('limits the long side to 2048 px and the thumbnail to 512 px', async () => {
    const m = await uploadOk(AUTHOR, await png(3000, 1000));
    expect([m.width, m.height]).toEqual([2048, 683]);
    const thumb = await sharp(storage.objects.get(`media/${m.id}/thumb.jpg`)!.body).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(512);
  });

  it('accepts PNG and WebP (converted to JPEG); the declared content type is ignored', async () => {
    for (const buf of [await png(), await webp()]) {
      const res = await upload(AUTHOR, buf, {
        contentType: 'application/octet-stream',
        filename: 'x.bin',
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it('HEIC: a clear 415 HEIC_NOT_SUPPORTED, not a 500 (our sharp build has no HEVC decoder)', async () => {
    const res = await upload(AUTHOR, heicLike(), {
      filename: 'IMG_0001.HEIC',
      contentType: 'image/heic',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('HEIC_NOT_SUPPORTED');
  });

  it.each<[string, () => Promise<Buffer> | Buffer, number, string]>([
    ['GIF', () => gif(), 415, 'UNSUPPORTED_IMAGE_TYPE'],
    [
      'plain text pretending to be JPEG',
      () => Buffer.from('hello, not an image'),
      415,
      'UNSUPPORTED_IMAGE_TYPE',
    ],
    [
      'a truncated JPEG',
      () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]),
      422,
      'IMAGE_INVALID',
    ],
    ['a decompression bomb (64 megapixels)', () => hugePng(), 422, 'IMAGE_INVALID'],
  ])('rejects %s', async (_name, make, status, code) => {
    const res = await upload(AUTHOR, await make());
    expect(res.statusCode, res.body).toBe(status);
    expect(res.json().error.code).toBe(code);
    expect(storage.objects.size).toBe(0);
    expect((await admin.query('SELECT count(*) FROM media')).rows[0].count).toBe('0');
  });

  it('rejects files over 10 MB with 413 IMAGE_TOO_LARGE', async () => {
    const big = Buffer.concat([await png(), Buffer.alloc(10 * 1024 * 1024 + 1, 0)]);
    const res = await upload(AUTHOR, big);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.code).toBe('IMAGE_TOO_LARGE');
  });

  it('needs multipart with a "file" field', async () => {
    expect((await call('POST', '/media', AUTHOR, { file: 'x' })).statusCode).toBe(400);
    expect((await upload(AUTHOR, await png(), { field: 'photo' })).statusCode).toBe(400);
  });
});

describe('photos in recipes', () => {
  it('cover and step photos come back as signed links, also in the list', async () => {
    const cover = await uploadOk(AUTHOR);
    const step = await uploadOk(AUTHOR);
    const body = fullRecipe({ cover_media_id: cover.id, status: 'published', visibility: 'book' });
    (body.steps[0] as Record<string, unknown>).photo_media_id = step.id;
    const r = (await call('POST', '/recipes', AUTHOR, body)).json();
    expect(r.cover).toMatchObject({
      id: cover.id,
      width: cover.width,
      url: expect.stringContaining(cover.id),
    });
    expect(r.steps[0].photo).toMatchObject({
      id: step.id,
      thumb_url: expect.stringContaining('thumb.jpg'),
    });
    expect(r.steps[1].photo).toBeNull();

    const seenByMember = (await call('GET', `/recipes/${r.id}`, MEMBER)).json();
    expect(seenByMember.cover.id).toBe(cover.id);
    const list = (await call('GET', '/recipes?scope=book', MEMBER)).json();
    expect(list.items[0].cover).toMatchObject({ id: cover.id, thumb_url: expect.any(String) });
  });

  it("an author cannot attach someone else's photo", async () => {
    const theirs = await uploadOk(MEMBER);
    const res = await call('POST', '/recipes', AUTHOR, { title: 'T', cover_media_id: theirs.id });
    expect(res.statusCode).toBe(400);
    const r = (await call('POST', '/recipes', AUTHOR, { title: 'T' })).json();
    expect(
      (await call('PATCH', `/recipes/${r.id}`, AUTHOR, { cover_media_id: theirs.id })).statusCode,
    ).toBe(400);
  });

  it('at most 20 photos per recipe (PRD 7.1)', async () => {
    const ids: string[] = [];
    for (let n = 0; n < 21; n++) ids.push((await uploadOk(AUTHOR)).id);
    const steps = ids.slice(1).map((id) => ({ body: 'x', photo_media_id: id }));
    const res = await call('POST', '/recipes', AUTHOR, {
      title: 'T',
      cover_media_id: ids[0],
      steps,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/at most 20 photos/);
  });

  it('who can see a photo row: its owner, and readers of a recipe that uses it', async () => {
    const m = await uploadOk(AUTHOR);
    const ids = Object.fromEntries(
      await Promise.all(
        [AUTHOR, MEMBER, OUTSIDER].map(async (tg) => [
          tg,
          (await admin.query('SELECT id FROM users WHERE tg_user_id = $1', [tg])).rows[0].id,
        ]),
      ),
    );
    const sees = (tg: number) =>
      withUser(
        db,
        { userId: ids[tg] },
        async (tx) => (await tx.query('SELECT 1 FROM media WHERE id = $1', [m.id])).rowCount,
      );
    expect([await sees(AUTHOR), await sees(MEMBER)]).toEqual([1, 0]); // an unused upload is private
    const r = (
      await call(
        'POST',
        '/recipes',
        AUTHOR,
        fullRecipe({ cover_media_id: m.id, status: 'published', visibility: 'book' }),
      )
    ).json();
    expect([await sees(MEMBER), await sees(OUTSIDER)]).toEqual([1, 0]);
    await call('POST', `/recipes/${r.id}/unpublish`, AUTHOR);
    expect(await sees(MEMBER)).toBe(0);
  });
});

describe('orphan clean-up (worker job)', () => {
  it('removes unused uploads older than 24 h (rows and files) and keeps used or fresh ones', async () => {
    const used = await uploadOk(AUTHOR);
    const oldOrphan = await uploadOk(AUTHOR);
    const freshOrphan = await uploadOk(AUTHOR);
    await call('POST', '/recipes', AUTHOR, { title: 'T', cover_media_id: used.id });
    await admin.query(
      "UPDATE media SET created_at = now() - interval '25 hours' WHERE id = ANY($1)",
      [[used.id, oldOrphan.id]],
    );

    expect(await cleanupOrphanMedia(db, storage)).toBe(1);
    const left = (await admin.query('SELECT id FROM media ORDER BY created_at')).rows
      .map((r) => r.id)
      .sort();
    expect(left).toEqual([used.id, freshOrphan.id].sort());
    expect(storage.objects.has(`media/${oldOrphan.id}/full.jpg`)).toBe(false);
    expect(storage.objects.has(`media/${oldOrphan.id}/thumb.jpg`)).toBe(false);
    expect(storage.objects.has(`media/${used.id}/full.jpg`)).toBe(true);
    expect(await cleanupOrphanMedia(db, storage)).toBe(0);
  });
});
