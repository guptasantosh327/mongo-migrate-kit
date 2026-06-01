import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'src/index.ts', 'src/cli/**', 'bin/**'],
      thresholds: { lines: 90, functions: 90, branches: 85 },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
