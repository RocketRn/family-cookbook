import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Workspace packages are used from their TypeScript sources in tests ('source' export condition).
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setupEnv.ts'],
    server: { deps: { inline: ['@cookbook/recipe-core'] } },
    // Test files share one database, so they run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
