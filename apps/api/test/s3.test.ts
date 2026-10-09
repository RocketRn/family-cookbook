import { beforeAll, describe, expect, it } from 'vitest';
import { S3Storage, signingWindow } from '../src/storage/storage.js';

/**
 * Contract test against a real S3-compatible server: SeaweedFS in docker-compose and CI, and
 * Google Cloud Storage on the production server (`docker compose run --rm s3check`, D-045).
 * Runs when S3_TEST_ENDPOINT is set; CI sets it and fails if it is missing.
 *   S3_TEST_BUCKET  an existing bucket to use (then it is not created); default cookbook-test
 *   S3_TEST_REGION  default us-east-1 (GCS: auto)
 *   S3_TEST_PREFIX  where the test's objects go inside the bucket; they are deleted at the end
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const givenBucket = process.env.S3_TEST_BUCKET;
const prefix = process.env.S3_TEST_PREFIX ?? '';
if (process.env.CI && !endpoint)
  throw new Error('CI must provide S3_TEST_ENDPOINT for the S3 contract test');

describe.skipIf(!endpoint)('S3Storage against a real S3 API', () => {
  const storage = new S3Storage({
    endpoint: endpoint!,
    publicEndpoint: endpoint!,
    region: process.env.S3_TEST_REGION ?? 'us-east-1',
    // One fixed bucket; every run uses fresh keys (a bucket per run would pile up in a dev store).
    bucket: givenBucket ?? 'cookbook-test',
    accessKey: process.env.S3_TEST_ACCESS_KEY ?? 'cookbook-dev',
    secretKey: process.env.S3_TEST_SECRET_KEY ?? 'cookbook-dev-secret',
    forcePathStyle: true,
  });

  beforeAll(async () => {
    try {
      await fetch(endpoint!);
    } catch {
      throw new Error(
        `No S3 server at ${endpoint}. Start it with "docker compose up -d" (or unset S3_TEST_ENDPOINT).`,
      );
    }
  });

  it('creates the bucket, stores, signs a link a browser can open, and deletes', async () => {
    // A production bucket is made in the cloud console, and its keys may not create buckets.
    if (!givenBucket) {
      await storage.ensureBucket();
      await storage.ensureBucket(); // idempotent
    }
    const key = `${prefix}media/${crypto.randomUUID()}/full.jpg`;
    await storage.put(key, Buffer.from('jpeg bytes'), 'image/jpeg');
    expect((await storage.get(key))?.toString()).toBe('jpeg bytes');

    const url = await storage.url(key);
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(await res.text()).toBe('jpeg bytes');
    expect(
      (await fetch(url.replace(/X-Amz-Signature=[0-9a-f]+/, 'X-Amz-Signature=' + '0'.repeat(64))))
        .status,
    ).toBe(403);

    await storage.delete([key]);
    expect(await storage.get(key)).toBeNull();
  });
});

describe('signed links', () => {
  it('are stable within an hour (cacheable) and valid for at least an hour', () => {
    const t = Date.parse('2026-10-09T10:20:00Z');
    const a = signingWindow(t);
    const b = signingWindow(t + 30 * 60 * 1000);
    expect(a.signingDate.toISOString()).toBe('2026-10-09T10:00:00.000Z');
    expect(b.signingDate).toEqual(a.signingDate);
    expect(a.expiresIn).toBe(7200);
  });
});
