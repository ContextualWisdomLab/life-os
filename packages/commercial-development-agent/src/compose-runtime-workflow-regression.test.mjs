import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/ci.yml',
);
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');

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
});
