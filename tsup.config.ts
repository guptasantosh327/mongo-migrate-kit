import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// Inject the package version into the CLI bundle at build time so `mmk --version`
// always matches package.json — no hand-maintained version string to forget.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig([
  // Library build (CJS + ESM)
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    shims: true,
    sourcemap: true,
    treeshake: true,
  },
  // CLI build (CJS only — Node CLI must be CJS for broadest compat)
  {
    entry: { mmk: 'bin/mmk.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    shims: true,
    define: { 'process.env.MMK_VERSION': JSON.stringify(version) },
    banner: { js: '#!/usr/bin/env node' },
  },
]);
