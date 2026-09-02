import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');
const writer = resolve(repositoryRoot, 'infra/kubernetes/write-pg-service.py');

/** Run the production service-file writer with one synthetic database URI. */
function writeServiceFile(databaseUrl: string) {
  const directory = mkdtempSync(join(tmpdir(), 'life-os-pg-options-'));
  return spawnSync(
    'python',
    [
      writer,
      '--environment-variable',
      'TEST_DATABASE_URL',
      '--service-name',
      'identity',
      '--output',
      join(directory, 'pg_service.conf'),
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl },
      timeout: 10_000,
    },
  );
}

describe('PostgreSQL startup-option authority', () => {
  it('rejects URI options so deployment safety settings cannot be overridden by connection metadata', () => {
    const options = encodeURIComponent(
      '-c life_os.identity_schema_rename_confirmation=blocked-by-uri',
    );
    const result = writeServiceFile(
      `postgresql://life_user:password@db.example:5432/life_os?options=${options}`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'unsupported PostgreSQL URI parameter: options',
    );
  });
});
