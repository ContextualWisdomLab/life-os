import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMERCIAL_DEVELOPMENT_RUN_SCHEMA } from './contracts.mjs';
import {
  CommercialDevelopmentReceiptError,
  createCommercialDevelopmentReceipt,
  serializeCommercialDevelopmentReceipt,
} from './receipt.mjs';

const POLICY = JSON.parse(
  readFileSync(
    new URL(
      '../../../product/opencode-commercial-development-policy.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const RUN_ID = '11111111-1111-4111-8111-111111111111';

/** Returns one complete run fixture. */
function run() {
  return {
    schema: COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
    run_id: RUN_ID,
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

/** Returns one issue projection. */
function issue() {
  return {
    number: 119,
    url: 'https://github.com/ContextualWisdomLab/life-os/issues/119',
    title:
      'Add durable Today workspace synchronization with optimistic concurrency',
    body: 'Implement one bounded durable Today synchronization slice.',
    state: 'open',
  };
}

describe('commercial development receipt composition', () => {
  it('creates one completed credential-free receipt', () => {
    const receipt = createCommercialDevelopmentReceipt({
      run: run(),
      policy: POLICY,
      issue: issue(),
      status: 'completed',
      reasonCode: 'completed',
      opencodeVersion: '1.2.3',
      diff: {
        changed_files: 3,
        changed_bytes: 4_096,
        additions: 120,
        deletions: 12,
      },
      branchName: `automation/opencode-commercial-${RUN_ID}`,
      pullRequestUrl: 'https://github.com/ContextualWisdomLab/life-os/pull/120',
      completedAt: '2026-08-07T01:30:00.000Z',
      validations: [
        { name: 'issue_policy', status: 'passed' },
        { name: 'diff_policy', status: 'passed' },
      ],
    });
    expect(receipt).toMatchObject({
      run_id: RUN_ID,
      status: 'completed',
      reason_code: 'completed',
      issue: { number: 119 },
      changed_files: 3,
      branch_name: `automation/opencode-commercial-${RUN_ID}`,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    const serialized = serializeCommercialDevelopmentReceipt(receipt);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(JSON.parse(serialized)).toEqual(receipt);
    for (const prohibited of [
      issue().body,
      'NVIDIA_NIM_API_KEY',
      'GITHUB_TOKEN',
      'hidden reasoning',
    ]) {
      expect(serialized).not.toContain(prohibited);
    }
  });

  it('creates a provider-missing receipt without branch mutation evidence', () => {
    const receipt = createCommercialDevelopmentReceipt({
      run: run(),
      policy: POLICY,
      issue: null,
      status: 'unavailable',
      reasonCode: 'provider_credential_missing',
      opencodeVersion: '1.2.3',
      diff: null,
      branchName: null,
      pullRequestUrl: null,
      completedAt: '2026-08-07T01:00:01.000Z',
      validations: [
        { name: 'provider_credential', status: 'failed' },
        { name: 'diff_policy', status: 'skipped' },
      ],
    });
    expect(receipt).toMatchObject({
      issue: null,
      changed_files: 0,
      changed_bytes: 0,
      additions: 0,
      deletions: 0,
      branch_name: null,
      pull_request_url: null,
    });
  });

  it.each([
    null,
    {},
    {
      run: run(),
      policy: POLICY,
      issue: issue(),
      status: 'completed',
      reasonCode: 'provider_unavailable',
      opencodeVersion: '1.2.3',
      diff: null,
      branchName: `automation/opencode-commercial-${RUN_ID}`,
      pullRequestUrl: 'https://github.com/ContextualWisdomLab/life-os/pull/120',
      completedAt: '2026-08-07T01:30:00.000Z',
      validations: [{ name: 'diff_policy', status: 'failed' }],
    },
    {
      run: run(),
      policy: POLICY,
      issue: issue(),
      status: 'completed',
      reasonCode: 'completed',
      opencodeVersion: 'x'.repeat(129),
      diff: null,
      branchName: `automation/opencode-commercial-${RUN_ID}`,
      pullRequestUrl: 'https://github.com/ContextualWisdomLab/life-os/pull/120',
      completedAt: '2026-08-07T01:30:00.000Z',
      validations: [{ name: 'diff_policy', status: 'passed' }],
    },
  ])('rejects invalid receipt composition %#', (value) => {
    expect(() => createCommercialDevelopmentReceipt(value)).toThrow(
      CommercialDevelopmentReceiptError,
    );
  });

  it('sanitizes invalid receipt serialization', () => {
    expect(() =>
      serializeCommercialDevelopmentReceipt({ secret: 'private' }),
    ).toThrow(CommercialDevelopmentReceiptError);
  });
});
