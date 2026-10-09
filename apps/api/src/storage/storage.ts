import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageConfig } from './config.js';

/** Everything the app does with files. Only the S3 API is used, so any S3-compatible store works. */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(keys: string[]): Promise<void>;
  /** Time-limited link a browser (or Telegram, for sendPhoto) can open without our auth header. */
  url(key: string): Promise<string>;
  /** Development convenience: create the bucket if it is missing. */
  ensureBucket(): Promise<void>;
}

/** Links are signed for the current hour window: identical within the hour (cacheable), valid >= 1 h. */
const WINDOW_SEC = 3600;
export function signingWindow(now = Date.now()): { signingDate: Date; expiresIn: number } {
  const start = Math.floor(now / 1000 / WINDOW_SEC) * WINDOW_SEC;
  return { signingDate: new Date(start * 1000), expiresIn: 2 * WINDOW_SEC };
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly publicClient: S3Client;

  constructor(
    private readonly cfg: StorageConfig,
    private readonly now: () => number = Date.now,
  ) {
    const base = {
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    };
    this.client = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.publicClient = new S3Client({ ...base, endpoint: cfg.publicEndpoint });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'private, max-age=31536000, immutable',
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      if (chunk.length) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.cfg.bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    }
  }

  async url(key: string): Promise<string> {
    const { signingDate, expiresIn } = signingWindow(this.now());
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      {
        expiresIn,
        signingDate,
      },
    );
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
    }
  }
}

/** In-memory storage for tests. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  async put(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async get(key: string) {
    return this.objects.get(key)?.body ?? null;
  }
  async delete(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }
  async url(key: string) {
    return `https://media.test/${key}?signed=1`;
  }
  async ensureBucket() {}
}
