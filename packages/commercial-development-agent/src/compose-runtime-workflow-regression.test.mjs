import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/ci.yml',
);
const COMPOSE_PATH = resolve(import.meta.dirname, '../../../compose.yaml');
const LEGACY_UPGRADE_PATH = resolve(
  import.meta.dirname,
  '../../../infra/postgres/provision/upgrade-legacy-local.sh',
);
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');
const compose = readFileSync(COMPOSE_PATH, 'utf8');
const legacyUpgrade = existsSync(LEGACY_UPGRADE_PATH)
  ? readFileSync(LEGACY_UPGRADE_PATH, 'utf8')
  : '';

/** Returns one named CI step so assertions stay scoped to its shell contract. */
function ciStep(name) {
  const marker = `      - name: ${name}\n`;
  const start = ciWorkflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = ciWorkflow.indexOf('\n      - name: ', start + marker.length);
  return ciWorkflow.slice(start, next === -1 ? ciWorkflow.length : next);
}

describe('Compose runtime provisioning workflow', () => {
  it('waits for long-running dependencies before running the one-shot provisioner synchronously', () => {
    const runtime = ciStep('Start and probe Compose infrastructure');

    const dependencyCommand =
      'docker compose up --detach --wait --wait-timeout 90 postgres nats';
    const provisionerCommand =
      'docker compose run --rm --no-deps notification-db-provision';
    const databaseProbe = 'docker compose exec --no-TTY postgres psql';

    expect(runtime).toContain(dependencyCommand);
    expect(runtime).not.toContain(
      'docker compose up --detach --wait --wait-timeout 90\n',
    );
    expect(runtime).toContain(provisionerCommand);
    expect(runtime.indexOf(provisionerCommand)).toBeGreaterThan(
      runtime.indexOf(dependencyCommand),
    );
    expect(runtime.indexOf(databaseProbe)).toBeGreaterThan(
      runtime.indexOf(provisionerCommand),
    );
    expect(runtime).not.toContain(
      'docker compose up --detach --no-deps notification-db-provision',
    );
    expect(runtime).not.toContain(
      'docker compose ps --all --quiet notification-db-provision',
    );
    expect(runtime).toContain('docker compose down --volumes --remove-orphans');
  });

  it('requires a fresh local PostgreSQL administrator password while preserving an explicit legacy-volume rotation path', () => {
    expect(compose).toContain('${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}');
    expect(compose).not.toContain('${POSTGRES_PASSWORD:-lifeos}');
    expect(compose).toContain(
      '${NOTIFICATION_RUNTIME_DATABASE_PASSWORD:?Set NOTIFICATION_RUNTIME_DATABASE_PASSWORD}',
    );
    expect(legacyUpgrade).toContain("POSTGRES_PASSWORD must not remain 'lifeos'");
    expect(legacyUpgrade).toContain("ALTER ROLE lifeos PASSWORD :'next_admin_password';");
    expect(legacyUpgrade).toContain(
      'docker compose run --rm --no-deps notification-db-provision',
    );
    expect(legacyUpgrade).not.toContain('POSTGRES_PASSWORD=lifeos');
  });
});
