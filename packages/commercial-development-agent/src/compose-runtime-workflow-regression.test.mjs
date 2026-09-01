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
  it('waits only for long-running dependencies before starting the one-shot provisioner', () => {
    const runtime = ciStep('Start and probe Compose infrastructure');

    expect(runtime).toContain(
      'docker compose up --detach --wait --wait-timeout 90 postgres nats',
    );
    expect(runtime).not.toContain(
      'docker compose up --detach --wait --wait-timeout 90\n',
    );

    const dependencyReady = runtime.indexOf(
      'docker compose up --detach --wait --wait-timeout 90 postgres nats',
    );
    const provisionerStart = runtime.indexOf(
      'docker compose up --detach --no-deps notification-db-provision',
    );
    const provisionerInspect = runtime.indexOf(
      'docker compose ps --all --quiet notification-db-provision',
    );

    expect(provisionerStart).toBeGreaterThan(dependencyReady);
    expect(provisionerInspect).toBeGreaterThan(provisionerStart);
    expect(runtime).toContain("= 'exited'");
    expect(runtime).toContain("= '0'");
    expect(runtime).toContain('docker compose down --volumes --remove-orphans');
  });
});
