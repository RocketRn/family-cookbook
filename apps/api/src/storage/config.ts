import { z } from 'zod';

/**
 * S3-compatible object storage, configured only through env (D-026): SeaweedFS locally, any S3 API
 * provider in production. Shared by the API and the worker.
 */
export const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  /** Address browsers use for photo links, if different from the one the API uses (e.g. in Docker). */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type StorageConfig = {
  endpoint: string;
  publicEndpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
};

/** The fake keys from .env.example / docker/seaweedfs/s3.json must never reach production. */
export const DEV_S3_KEYS = /^cookbook-dev/;

export function toStorageConfig(e: z.infer<typeof storageEnvSchema>): StorageConfig {
  return {
    endpoint: e.S3_ENDPOINT,
    publicEndpoint: e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT,
    region: e.S3_REGION,
    bucket: e.S3_BUCKET,
    accessKey: e.S3_ACCESS_KEY,
    secretKey: e.S3_SECRET_KEY,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
  };
}
