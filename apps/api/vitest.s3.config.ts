import { defineConfig } from 'vitest/config';

/**
 * Only the S3 contract test, without the database (`pnpm --filter @cookbook/api test:s3`): run on
 * the production server against Google Cloud Storage (docs/DEPLOY-GCP.ru.md, D-045).
 */
export default defineConfig({
  test: { include: ['test/s3.test.ts'], testTimeout: 30_000 },
});
