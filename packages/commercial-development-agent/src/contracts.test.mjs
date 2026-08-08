import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_DEVELOPMENT_POLICY_SCHEMA,
  COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA,
  COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
  CommercialDevelopmentContractError,
  normalizeCommercialDevelopmentPolicy,
  validateCommercialDevelopmentIssue,
  validateCommercialDevelopmentReceipt,
  validateCommercialDevelopmentRun,
} from './contracts.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const BASE_SHA = 'a'.repeat(40);
const STARTED_AT = '2026-08-07T01:00:00.000Z';
const COMPLETED_AT = '2026-08-07T01:30:00.000Z';

/** Returns one complete mutable policy fixture. */
function policy() {
  return {
    schema: COMMERCIAL_DEVELOPMENT_POLICY_SCHEMA,
    eligible_issue_titles: [
      'Add durable Today workspace synchronization with optimistic concurrency',
    ],
    excluded_issue_numbers: [21],
    allowed_path_prefixes: ['apps/', 'packages/', 'docs/', 'product/'],
    allowed_root_files: ['README.md', 'ARCHITECTURE.md', 'CHANGELOG.md'],
    prohibited_path_prefixes: [
      '.github/',
      '.git/',
      'infra/',
      'coverage/',
      'dist/',
      'build/',
      'node_modules/',
    ],
    prohibited_exact_paths: [
      '.env',
      '.env.example',
      'SECURITY.md',
      'CODEOWNERS',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'product/opencode-commercial-development-policy.json',
    ],
    maximum_changed_files: 24,
    maximum_changed_bytes: 131_072,
    maximum_changed_lines: 3_000,
    maximum_prompt_bytes: 32_768,
    maximum_issue_body_bytes: 16_384,
    maximum_issue_title_bytes: 512,
    maximum_open_pull_requests: 100,
    maximum_open_issues: 100,
    maximum_opencode_minutes: 90,
    maximum_workflow_minutes: 120,
    receipt_retention_days: 7,
    default_reasoning_effort: 'high',
    maximum_recursive_depth: 1,
    maximum_decomposition_steps: 8,
    allowed_roles: ['planner', 'worker', 'verifier', 'synthesizer'],
  };
}

/** Returns one complete run fixture. */
function run() {
  return {
    schema: COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
    run_id: RUN_ID,
    repository: 'ContextualWisdomLab/life-os',
    base_sha: BASE_SHA,
    started_at: STARTED_AT,
    model_label: 'nvidia/default-chat-model',
    reasoning_effort: 'high',
    recursive_depth: 1,
    decomposition_steps: 8,
    roles: ['planner', 'worker', 'verifier', 'synthesizer'],
  };
}

/** Returns one projected GitHub issue fixture. */
function issue() {
  return {
    number: 119,
    url: 'https://github.com/ContextualWisdomLab/life-os/issues/119',
    title:
      'Add durable Today workspace synchronization with optimistic concurrency',
    body: 'Implement one bounded authenticated Today synchronization slice.',
    state: 'open',
  };
}

/** Returns one complete receipt fixture. */
function receipt() {
  return {
    schema: COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA,
    run_id: RUN_ID,
    repository: 'ContextualWisdomLab/life-os',
    base_sha: BASE_SHA,
    issue: {
      number: 119,
      url: 'https://github.com/ContextualWisdomLab/life-os/issues/119',
    },
    status: 'completed',
    reason_code: 'completed',
    opencode_version: '1.0.0',
    model_label: 'nvidia/default-chat-model',
    changed_files: 3,
    changed_bytes: 4_096,
    additions: 120,
    deletions: 12,
    branch_name: `automation/opencode-commercial-${RUN_ID}`,
    pull_request_url:
      'https://github.com/ContextualWisdomLab/life-os/pull/120',
    started_at: STARTED_AT,
    completed_at: COMPLETED_AT,
    validations: [
      { name: 'issue_policy', status: 'passed' },
      { name: 'diff_policy', status: 'passed' },
    ],
  };
}

describe('commercial development policy contract', () => {
  it('normalizes and deeply freezes the complete policy', () => {
    const normalized = normalizeCommercialDevelopmentPolicy(policy());
    expect(normalized).toEqual(policy());
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized.allowed_roles)).toBe(true);
    expect(Object.isFrozen(normalized.eligible_issue_titles)).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { ...policy(), schema: 'wrong' },
    { ...policy(), extra: true },
    { ...policy(), eligible_issue_titles: [] },
    { ...policy(), eligible_issue_titles: ['duplicate', 'duplicate'] },
    { ...policy(), excluded_issue_numbers: [0] },
    { ...policy(), excluded_issue_numbers: [21, 21] },
    { ...policy(), allowed_path_prefixes: ['apps'] },
    { ...policy(), allowed_path_prefixes: ['../apps/'] },
    { ...policy(), allowed_root_files: ['nested/file.md'] },
    { ...policy(), prohibited_path_prefixes: [] },
    { ...policy(), prohibited_exact_paths: ['../workflow.yml'] },
    { ...policy(), prohibited_exact_paths: ['/workflow.yml'] },
    { ...policy(), prohibited_exact_paths: ['.github\\workflow.yml'] },
    { ...policy(), prohibited_exact_paths: ['product/../workflow.yml'] },
    { ...policy(), maximum_changed_files: 0 },
    { ...policy(), maximum_changed_files: 101 },
    { ...policy(), maximum_changed_bytes: 1_024 },
    { ...policy(), maximum_changed_lines: 100_001 },
    { ...policy(), maximum_prompt_bytes: 1_024 },
    { ...policy(), maximum_issue_body_bytes: 1_024 },
    { ...policy(), maximum_issue_title_bytes: 4_097 },
    { ...policy(), maximum_open_pull_requests: 0 },
    { ...policy(), maximum_open_issues: 1_001 },
    { ...policy(), maximum_opencode_minutes: 0 },
    { ...policy(), maximum_workflow_minutes: 89 },
    { ...policy(), receipt_retention_days: 91 },
    { ...policy(), default_reasoning_effort: 'extreme' },
    { ...policy(), maximum_recursive_depth: 9 },
    { ...policy(), maximum_decomposition_steps: 0 },
    { ...policy(), allowed_roles: ['Planner'] },
  ])('rejects invalid policy %#', (value) => {
    expect(() => normalizeCommercialDevelopmentPolicy(value)).toThrow(
      CommercialDevelopmentContractError,
    );
  });
});

describe('commercial development run contract', () => {
  it('validates and freezes an explicit bounded run', () => {
    const validated = validateCommercialDevelopmentRun(run(), policy());
    expect(validated).toEqual(run());
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.roles)).toBe(true);
  });

  it.each([
    { ...run(), run_id: '123456' },
    { ...run(), run_id: '11111111-1111-1111-1111-111111111111' },
    { ...run(), repository: 'life-os' },
    { ...run(), repository: 'owner/repo/extra' },
    { ...run(), base_sha: 'A'.repeat(40) },
    { ...run(), started_at: '2026-08-07T01:00:00Z' },
    { ...run(), model_label: 'sk-private-model' },
    { ...run(), reasoning_effort: 'extreme' },
    { ...run(), recursive_depth: 2 },
    { ...run(), decomposition_steps: 9 },
    { ...run(), roles: ['planner', 'planner'] },
    { ...run(), roles: ['administrator'] },
    { ...run(), extra: true },
  ])('rejects unsafe run %#', (value) => {
    expect(() => validateCommercialDevelopmentRun(value, policy())).toThrow(
      CommercialDevelopmentContractError,
    );
  });
});

describe('external issue projection contract', () => {
  it('validates one bounded open GitHub issue', () => {
    const validated = validateCommercialDevelopmentIssue(issue(), policy());
    expect(validated).toEqual(issue());
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it('preserves bounded multiline issue text as untrusted data', () => {
    const value = {
      ...issue(),
      body: '\tFirst line\r\nSecond line\n',
    };
    expect(validateCommercialDevelopmentIssue(value, policy())).toEqual(value);
  });

  it.each([
    { ...issue(), number: 0 },
    { ...issue(), number: 1.5 },
    { ...issue(), url: 'https://example.com/issues/119' },
    { ...issue(), url: 'https://github.com/other/repo/issues/119' },
    { ...issue(), title: '' },
    { ...issue(), title: 'x'.repeat(513) },
    { ...issue(), body: null },
    { ...issue(), body: 'x'.repeat(16_385) },
    { ...issue(), body: 'line\u0000break' },
    { ...issue(), state: 'closed' },
    { ...issue(), pull_request: {} },
    { ...issue(), extra: true },
  ])('rejects unsafe projected issue %#', (value) => {
    expect(() => validateCommercialDevelopmentIssue(value, policy())).toThrow(
      CommercialDevelopmentContractError,
    );
  });
});

describe('credential-free receipt contract', () => {
  it('validates and deeply freezes a completed receipt', () => {
    const validated = validateCommercialDevelopmentReceipt(receipt());
    expect(validated).toEqual(receipt());
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.issue)).toBe(true);
    expect(Object.isFrozen(validated.validations)).toBe(true);
  });

  it('accepts an unavailable receipt with null mutation evidence', () => {
    const value = {
      ...receipt(),
      issue: null,
      status: 'unavailable',
      reason_code: 'provider_credential_missing',
      changed_files: 0,
      changed_bytes: 0,
      additions: 0,
      deletions: 0,
      branch_name: null,
      pull_request_url: null,
    };
    expect(validateCommercialDevelopmentReceipt(value)).toEqual(value);
  });

  it.each([
    { ...receipt(), schema: 'wrong' },
    { ...receipt(), run_id: '7' },
    { ...receipt(), status: 'success' },
    { ...receipt(), reason_code: 'private_error' },
    { ...receipt(), opencode_version: '' },
    { ...receipt(), model_label: 'nvapi-private-value' },
    { ...receipt(), changed_files: 1.5 },
    { ...receipt(), changed_bytes: -1 },
    { ...receipt(), branch_name: 'automation/opencode-commercial-123' },
    { ...receipt(), pull_request_url: 'https://example.com/pull/120' },
    { ...receipt(), completed_at: STARTED_AT.replace('01:00', '00:59') },
    { ...receipt(), validations: [] },
    {
      ...receipt(),
      validations: [{ name: 'diff_policy', status: 'unknown' }],
    },
    { ...receipt(), prompt: 'private prompt' },
  ])('rejects unsafe receipt %#', (value) => {
    expect(() => validateCommercialDevelopmentReceipt(value)).toThrow(
      CommercialDevelopmentContractError,
    );
  });

  it('never echoes rejected secret-shaped input', () => {
    const secret = 'nvapi-super-private-secret-value';
    let failure;
    try {
      validateCommercialDevelopmentReceipt({
        ...receipt(),
        model_label: secret,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CommercialDevelopmentContractError);
    expect(String(failure)).not.toContain(secret);
  });
});
