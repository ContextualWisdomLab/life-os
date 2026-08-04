import { defineConfig } from 'vitest/config';

/** Complete AI-service production coverage gate. */
export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: [['text', { maxCols: 1_000 }], 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
