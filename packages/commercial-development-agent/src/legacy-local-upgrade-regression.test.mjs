import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const upgrade = readFileSync(
  resolve(import.meta.dirname, '../../../infra/postgres/provision/upgrade-legacy-local.sh'),
  'utf8',
);

describe('Legacy local PostgreSQL upgrade', () => {
  it('uses the Compose-resolved database and password-authenticated TCP', () => {
    expect(upgrade).toContain('docker compose config --format json');
    expect(upgrade).toContain('EFFECTIVE_POSTGRES_DB');
    expect(upgrade).not.toContain('${POSTGRES_DB:-lifeos}');
    expect(upgrade.match(/--host=127\.0\.0\.1/gu)).toHaveLength(2);
  });
});
