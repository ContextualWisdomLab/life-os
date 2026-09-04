import { describe, expect, it } from 'vitest';
import {
  createNodePostgresPluginPool,
  type NodePostgresPoolConstructor,
} from './plugin-vault-postgres-driver';

const READINESS_SQL = 'SELECT 1 AS integration_plugin_runtime_ready';

describe('Integration-owned node-postgres method authority', () => {
  it(
    'captures the accepted query method once instead of re-reading a mutable pool accessor after readiness',
    async () => {
      let queryReads = 0;

      class StatefulQueryPool {
        on(): void {}

        get query(): (
          text: string,
          values?: readonly unknown[],
        ) => Promise<{
          readonly rows: readonly unknown[];
          readonly rowCount: number;
        }> {
          queryReads += 1;
          if (queryReads === 1) {
            return async (text: string) => {
              if (text === READINESS_SQL) {
                return {
                  rows: [{ integration_plugin_runtime_ready: 1 }],
                  rowCount: 1,
                };
              }
              return { rows: [{ stable: true }], rowCount: 1 };
            };
          }

          return async () => {
            throw new Error('password=must-not-become-late-query-authority');
          };
        }

        async end(): Promise<void> {}
      }

      const pool = await createNodePostgresPluginPool(
        'postgresql://integration:secret@db.example.invalid:5432/life_os',
        StatefulQueryPool as unknown as NodePostgresPoolConstructor,
        () => undefined,
      );

      await expect(pool.query('SELECT stable')).resolves.toEqual({
        rows: [{ stable: true }],
        rowCount: 1,
      });
      expect(queryReads).toBe(1);
    },
  );

  it(
    'captures the accepted shutdown method once before the pool crosses the runtime boundary',
    async () => {
      let endReads = 0;
      let stableEndCalls = 0;

      class StatefulEndPool {
        on(): void {}

        async query<Row>(text: string): Promise<{
          readonly rows: readonly Row[];
          readonly rowCount: number;
        }> {
          if (text === READINESS_SQL) {
            return {
              rows: [
                { integration_plugin_runtime_ready: 1 },
              ] as unknown as readonly Row[],
              rowCount: 1,
            };
          }
          return { rows: [], rowCount: 0 };
        }

        get end(): () => Promise<void> {
          endReads += 1;
          if (endReads === 1) {
            return async () => {
              stableEndCalls += 1;
            };
          }
          return async () => {
            throw new Error('password=must-not-become-late-end-authority');
          };
        }
      }

      const pool = await createNodePostgresPluginPool(
        'postgresql://integration:secret@db.example.invalid:5432/life_os',
        StatefulEndPool as unknown as NodePostgresPoolConstructor,
        () => undefined,
      );

      expect(endReads).toBe(1);
      await expect(pool.end()).resolves.toBeUndefined();
      expect(endReads).toBe(1);
      expect(stableEndCalls).toBe(1);
    },
  );
});
