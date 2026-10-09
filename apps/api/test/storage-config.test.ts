import { describe, expect, it } from 'vitest';
import { S3Storage } from '../src/storage/storage.js';

/**
 * Google Cloud Storage's S3-compatible API refuses the AWS SDK's newer default checksum headers
 * (D-045). Both clients (the one that uploads and the one that signs photo links) must send
 * checksums only where S3 requires them, and use path-style addresses when told to.
 */
type Resolved = {
  requestChecksumCalculation: () => Promise<string>;
  responseChecksumValidation: () => Promise<string>;
  forcePathStyle: boolean;
};

describe('S3 client settings', () => {
  for (const forcePathStyle of [true, false]) {
    it(`checksums only when required, path style ${forcePathStyle ? 'on' : 'off'}`, async () => {
      const storage = new S3Storage({
        endpoint: 'https://storage.googleapis.com',
        publicEndpoint: 'https://storage.googleapis.com',
        region: 'auto',
        bucket: 'family-cookbook-photos',
        accessKey: 'GOOG1EREALLOOKINGKEY',
        secretKey: 'real-looking-secret-0123456789',
        forcePathStyle,
      });
      // The two SDK clients are private; their resolved settings are what matters here.
      const clients = storage as unknown as {
        client: { config: Resolved };
        publicClient: { config: Resolved };
      };
      for (const c of [clients.client.config, clients.publicClient.config]) {
        expect(await c.requestChecksumCalculation()).toBe('WHEN_REQUIRED');
        expect(await c.responseChecksumValidation()).toBe('WHEN_REQUIRED');
        expect(c.forcePathStyle).toBe(forcePathStyle);
      }
    });
  }
});
