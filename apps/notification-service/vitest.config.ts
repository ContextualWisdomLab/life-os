import { defineConfig } from 'vitest/config';

const integrationDatabaseUrl =
  process.env.NOTIFICATION_DATABASE_URL ?? process.env.PLANNING_DATABASE_URL;
if (integrationDatabaseUrl !== undefined) {
  process.env.NOTIFICATION_DATABASE_URL = integrationDatabaseUrl;
}

/** Complete notification-service coverage gate. */
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
