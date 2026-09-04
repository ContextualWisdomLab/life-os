import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const MIGRATION_NAMES = [
  '0001_plugin_installation_record.sql',
  '0002_plugin_credential_binding_record.sql',
  '0003_plugin_operator_context_replay_record.sql',
  '0004_plugin_delivery_origin_grant_record.sql',
  '0005_plugin_credential_active_installation_guard.sql',
] as const;
const MIGRATIONS = MIGRATION_NAMES.map((name) =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'),
);

interface SqlExecution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function psqlConnection(applicationName?: string) {
  if (!DATABASE_URL) {
    throw new Error('A dedicated PostgreSQL integration test database URL is required');
  }
  const target = new URL(DATABASE_URL);
  return {
    args: [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      target.hostname,
      '-p',
      target.port || '5432',
      '-U',
      decodeURIComponent(target.username),
      '-d',
      decodeURIComponent(target.pathname.replace(/^\//u, '')),
      '-Atq',
    ],
    env: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(target.password),
      ...(applicationName ? { PGAPPNAME: applicationName } : {}),
    },
  };
}

function executeSql(sql: string): SqlExecution {
  const connection = psqlConnection();
  const result = spawnSync('psql', connection.args, {
    input: sql,
    encoding: 'utf8',
    env: connection.env,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function executeSqlAsync(
  sql: string,
  applicationName: string,
): Promise<SqlExecution> {
  const connection = psqlConnection(applicationName);
  return new Promise((resolve, reject) => {
    const child = spawn('psql', connection.args, {
      env: connection.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(sql);
  });
}

function requireSqlSuccess(sql: string): void {
  const result = executeSql(sql);
  if (result.status !== 0) {
    throw new Error(`PostgreSQL test setup failed: ${result.stderr.slice(0, 500)}`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForActiveApplication(applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = executeSql(`
      SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE application_name = '${applicationName}'
          AND state = 'active'
          AND query LIKE '%pg_sleep%'
      ) THEN 'ready' ELSE 'waiting' END;
    `);
    if (result.status === 0 && result.stdout.trim() === 'ready') {
      return;
    }
    await delay(50);
  }
  throw new Error('Credential-admission lock holder did not become observable');
}

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const LOCK_HOLDER_APPLICATION_NAME = 'life-os-plugin-credential-lock-holder';

const INSTALLATION_SQL = `
  INSERT INTO plugin_integration.plugin_installation_record (
    installation_id, workspace_id, installed_by_user_id, plugin_id,
    plugin_contract_version, manifest_sha256, granted_capabilities,
    installation_status, installed_at, revoked_at
  ) VALUES (
    '${INSTALLATION_ID}', '${WORKSPACE_ID}', '${USER_ID}',
    'example.plugin', '1.0.0', repeat('a', 64), ARRAY['delivery.https'],
    'active', '2026-09-04T00:00:00.000Z', NULL
  );
`;

const BINDING_SQL = `
  INSERT INTO plugin_integration.plugin_credential_binding_record (
    credential_binding_id, installation_id, workspace_id,
    installed_by_user_id, credential_name, secret_reference,
    credential_status, bound_at, revoked_at
  ) VALUES (
    '${BINDING_ID}', '${INSTALLATION_ID}', '${WORKSPACE_ID}', '${USER_ID}',
    'webhook.signing', 'kms://life-os/plugin/opaque-reference-001',
    'active', '2026-09-04T01:00:00.000Z', NULL
  );
`;

const REVOCATION_SQL = `
  UPDATE plugin_integration.plugin_installation_record
  SET installation_status = 'revoked',
      revoked_at = '2026-09-04T00:30:00.000Z'
  WHERE installation_id = '${INSTALLATION_ID}'::uuid;
`;

describeWithPostgres('plugin credential active-installation persistence fence', () => {
  beforeEach(() => {
    requireSqlSuccess('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
    requireSqlSuccess(MIGRATIONS.join('\n'));
    requireSqlSuccess(INSTALLATION_SQL);
  });

  it('rejects a new credential binding after the owning installation is durably revoked', () => {
    requireSqlSuccess(REVOCATION_SQL);

    const result = executeSql(BINDING_SQL);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('plugin_credential_active_installation_check');
  });

  it('serializes credential admission against installation revocation in PostgreSQL', async () => {
    const admission = executeSqlAsync(
      `
        BEGIN;
        ${BINDING_SQL}
        SELECT pg_sleep(1);
        COMMIT;
      `,
      LOCK_HOLDER_APPLICATION_NAME,
    );

    await waitForActiveApplication(LOCK_HOLDER_APPLICATION_NAME);

    const blockedRevocation = await executeSqlAsync(
      `
        SET lock_timeout = '250ms';
        ${REVOCATION_SQL}
      `,
      'life-os-plugin-credential-lock-contender',
    );

    expect(blockedRevocation.status).not.toBe(0);
    expect(blockedRevocation.stderr).toContain('lock timeout');

    const admitted = await admission;
    expect(admitted.status).toBe(0);

    requireSqlSuccess(REVOCATION_SQL);
    const finalState = executeSql(`
      SELECT i.installation_status,
             i.revoked_at IS NOT NULL,
             c.credential_status,
             c.revoked_at IS NULL
      FROM plugin_integration.plugin_installation_record AS i
      JOIN plugin_integration.plugin_credential_binding_record AS c
        ON c.installation_id = i.installation_id
       AND c.workspace_id = i.workspace_id
       AND c.installed_by_user_id = i.installed_by_user_id
      WHERE i.installation_id = '${INSTALLATION_ID}'::uuid;
    `);

    expect(finalState.status).toBe(0);
    expect(finalState.stdout.trim()).toBe('revoked|t|active|t');
  });
});
