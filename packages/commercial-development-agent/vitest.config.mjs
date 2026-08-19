import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 45_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.mjs'],
      exclude: ['src/cli.mjs'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
