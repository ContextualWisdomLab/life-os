import { defineConfig } from 'vitest/config';

/** Complete AI-service production coverage gate for explicit full-suite coverage runs. */
export default defineConfig({
  test: {
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      reporter: [['text', { maxCols: 1_000 }], 'json', 'json-summary'],
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
