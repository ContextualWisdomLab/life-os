import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { compileMaintenanceContract } from './contract.mjs';

const fixturePath = resolve(
  import.meta.dirname,
  '../fixtures/realistic-maintenance.json',
);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

/** Returns one named realistic maintenance fixture scenario. */
function scenario(name) {
  const value = fixture.scenarios.find((item) => item.name === name);
  assert.ok(value, `missing fixture scenario ${name}`);
  return value;
}

describe('realistic OpenCode maintenance dry-run fixture', () => {
  it('prioritizes a failing PR and actionable security review before product work', () => {
    assert.equal(fixture.schema, 'life-os.maintenance-fixture.v1');
    const value = scenario('failing_check_with_actionable_security_review');
    const contract = compileMaintenanceContract(value.input);

    assert.equal(contract.action, value.expected.action);
    assert.equal(contract.computeProfile, value.expected.computeProfile);
    assert.equal(
      contract.target.externalNumber,
      value.expected.targetExternalNumber,
    );
    assert.deepEqual(contract.failedChecks, value.expected.failedChecks);
    assert.deepEqual(contract.findingClasses, value.expected.findingClasses);
    assert.equal(
      JSON.stringify(contract).includes('create or merge pull requests'),
      true,
    );
  });

  it('recommends the highest-value bounded buyer gap after the PR queue drains', () => {
    const value = scenario('reviewed_queue_drained_to_buyer_gap');
    const contract = compileMaintenanceContract(value.input);

    assert.equal(contract.action, value.expected.action);
    assert.equal(contract.computeProfile, value.expected.computeProfile);
    assert.equal(
      contract.target.capabilityId,
      value.expected.targetCapabilityId,
    );
    assert.deepEqual(contract.allowedPathPrefixes, [
      'apps/planning-service/',
      'apps/web/',
    ]);
  });
});
