import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
  CommercialDevelopmentContractError,
  validateCommercialDevelopmentRun,
} from './contracts.mjs';
import {
  CommercialDevelopmentCliError,
  runCommercialDevelopmentCli,
} from './cli-core.mjs';

const POLICY = JSON.parse(
  readFileSync(
    new URL(
      '../../../product/opencode-commercial-development-policy.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

/** Returns one complete valid run for policy-boundary verification. */
function validRun() {
  return {
    schema: COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
    run_id: '11111111-1111-4111-8111-111111111111',
    repository: 'ContextualWisdomLab/life-os',
    base_sha: 'a'.repeat(40),
    started_at: '2026-08-07T01:00:00.000Z',
    model_label: 'nvidia/default-chat-model',
    reasoning_effort: 'high',
    recursive_depth: 1,
    decomposition_steps: 8,
    roles: ['planner', 'worker', 'verifier', 'synthesizer'],
  };
}

describe('commercial development fail-closed boundary regressions', () => {
  it('rejects an incomplete but syntactically valid CLI option set before file access', async () => {
    const fileSystem = { stat: vi.fn() };

    await expect(
      runCommercialDevelopmentCli(
        ['receipt', '--input', '/tmp/commercial-agent/input.json'],
        { fileSystem },
      ),
    ).rejects.toBeInstanceOf(CommercialDevelopmentCliError);
    expect(fileSystem.stat).not.toHaveBeenCalled();
  });

  it('rejects non-array excluded issue-number policy evidence', () => {
    expect(() =>
      validateCommercialDevelopmentRun(validRun(), {
        ...POLICY,
        excluded_issue_numbers: null,
      }),
    ).toThrow(CommercialDevelopmentContractError);
  });
});
