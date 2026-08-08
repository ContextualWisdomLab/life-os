import { defineConfig } from 'vitest/config';

const fullCoverageRequested =
  process.argv.includes('--coverage') || process.argv.includes('--coverage.enabled');

/** Complete AI-service production coverage gate for explicit full-suite coverage runs. */
export default defineConfig({
  test: {
    coverage: {
      enabled: fullCoverageRequested,
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
