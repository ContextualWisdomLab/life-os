import { afterEach, describe, expect, it } from 'vitest';
import {
  createNodePostgresPluginPool,
  PluginNodePostgresConfigurationError,
} from './plugin-vault-postgres-driver';
import type { PluginHostedPostgresPool } from './plugin-vault-hosted-runtime';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const HOST_MISMATCH_URL = process.env.INTEGRATION_DATABASE_TLS_HOST_MISMATCH_URL;
const REAL_TLS_ACCEPTANCE = process.env.INTEGRATION_POSTGRES_TLS_ACCEPTANCE === '1';
const describeWithRealTls =
  REAL_TLS_ACCEPTANCE && DATABASE_URL && HOST_MISMATCH_URL ? describe : describe.skip;

let acceptedPool: PluginHostedPostgresPool | undefined;

afterEach(async () => {
  const pool = acceptedPool;
  acceptedPool = undefined;
  if (pool !== undefined) {
    await pool.end();
  }
});

describeWithRealTls('Integration PostgreSQL verified-TLS acceptance', () => {
  it('proves encrypted peer-verified readiness and the configured server statement timeout', async () => {
    acceptedPool = await createNodePostgresPluginPool(DATABASE_URL!);

    const transport = await acceptedPool.query<{ readonly ssl: boolean }>(
      'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
    );
    expect(transport.rowCount).toBe(1);
    expect(transport.rows).toEqual([{ ssl: true }]);

    const timeout = await acceptedPool.query<{
      readonly statement_timeout: string;
    }>("SELECT current_setting('statement_timeout') AS statement_timeout");
    expect(timeout.rowCount).toBe(1);
    expect(timeout.rows).toEqual([{ statement_timeout: '5s' }]);

    await expect(acceptedPool.query('SELECT pg_sleep(10)')).rejects.toMatchObject({
      code: '57014',
    });

    const recovery = await acceptedPool.query<{ readonly ready: number }>(
      'SELECT 1 AS ready',
    );
    expect(recovery.rowCount).toBe(1);
    expect(recovery.rows).toEqual([{ ready: 1 }]);
  }, 15_000);

  it('rejects an otherwise trusted certificate when the PostgreSQL hostname does not match', async () => {
    await expect(
      createNodePostgresPluginPool(HOST_MISMATCH_URL!),
    ).rejects.toBeInstanceOf(PluginNodePostgresConfigurationError);
  });
});
