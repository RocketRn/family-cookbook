#!/usr/bin/env node
// Fails if the production web bundle contains the development Telegram mock or the fake dev token.
// Run after `pnpm build` (CI does). See docs/DECISIONS.md D-006.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web/dist');
const FORBIDDEN = [
  'DEV-ONLY-FAKE-TOKEN', // fake dev bot token
  'DEV-MOCK-SIGNATURE', // mock initData signature
  'mock BackButton', // mock back button label
  'installMockWebApp',
  'devUser',
  'dev-saved-shelf', // sample Saved shelf (apps/web/src/dev/DevSavedShelf.tsx), owner decision 5
  '00000000-0000-4000-8000-0000000000c2', // a dev seed recipe id used by that sample
  'dev-design-screens', // UX-03 design screens (apps/web/src/dev/design)
];

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

let all;
try {
  all = files(dist).filter((f) => /\.(js|css|html|map)$/.test(f));
} catch {
  console.error(`No build output at ${dist}. Run \`pnpm build\` first.`);
  process.exit(1);
}
const hits = all.flatMap((f) => {
  const text = readFileSync(f, 'utf8');
  return FORBIDDEN.filter((s) => text.includes(s)).map((s) => `${path.relative(dist, f)}: "${s}"`);
});
if (hits.length) {
  console.error(
    `Production bundle contains development-only code:\n${hits.map((h) => `  - ${h}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`Bundle check passed: ${all.length} files, no dev mock or fake token.`);
