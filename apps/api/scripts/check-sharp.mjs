#!/usr/bin/env node
// CI check (Sprint 2 decision 2): sharp loads on this Node version from its prebuilt binary
// package, not from a local compile. Prints the versions for the CI log.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
// sharp's exports hide package.json; its entry point is <package>/dist/index.cjs.
const sharpDir = path.resolve(path.dirname(require.resolve('sharp')), '..');
const pkg = `@img/sharp-${process.platform}-${process.arch}`;
let prebuilt;
try {
  prebuilt = createRequire(path.join(sharpDir, 'package.json'))(`${pkg}/package`);
} catch {
  console.error(`sharp has no prebuilt binary package ${pkg} on ${process.version}`);
  process.exit(1);
}
console.log(
  JSON.stringify({
    node: process.version,
    sharp: JSON.parse(readFileSync(path.join(sharpDir, 'package.json'), 'utf8')).version,
    prebuilt: `${prebuilt.name}@${prebuilt.version}`,
    libvips: sharp.versions.vips,
    // HEIF decoding in this build (iPhone HEIC needs it; it is false in the prebuilt binaries).
    heifInput: sharp.format.heif.input,
  }),
);
