import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildCsp, headersFile } from './csp';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

/** Production build only: the CSP (Report-Only, D-032) as `_headers` and as plain text. */
function cspReportOnly(): Plugin {
  return {
    name: 'csp-report-only',
    apply: 'build',
    generateBundle() {
      const csp = buildCsp(process.env);
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile(csp.headers) });
      this.emitFile({ type: 'asset', fileName: 'csp-report-only.txt', source: `${csp.policy}\n` });
    },
  };
}

export default defineConfig({
  plugins: [react(), cspReportOnly()],
  // `vite preview` serves the production build with the same headers as production.
  preview: { headers: buildCsp(process.env).headers },
  // Workspace packages (@cookbook/recipe-core) are compiled from their TypeScript sources.
  resolve: { conditions: ['source'] },
  server: {
    port: 5173,
    // Same-origin API calls in development: /api/* -> the Fastify API.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
