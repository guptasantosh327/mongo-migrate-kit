import { defineConfig } from 'tsup';

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
    banner: { js: '#!/usr/bin/env node' },
  },
]);
