import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateCapabilityManifest, validateCommercialReadinessPolicy } from './schema.mjs';

function capability(overrides = {}) {
  return {
    id: 'identity.oauth',
    outcome: 'A user can sign in securely with Google or GitHub.',
    target_maturity: 'production',
    customer_impact: 5,
    risk: 5,
    acquisition_impact: 5,
    effort: 3,
    dependencies: [],
    tracking_issue: 18,
    evidence: [
      {
        maturity: 'prototype',
        kind: 'implementation',
        mode: 'exists',
        path: 'apps/identity-service/src/oauth-provider.ts'
      }
    ],
    ...overrides
  };
}

function manifest(capabilities = [capability()]) {
  return {
    schema: 'life-os.capability-manifest.v1',
    capabilities
  };
}

describe('validateCapabilityManifest', () => {
  it('accepts and freezes a valid opaque capability graph', () => {
    const result = validateCapabilityManifest(manifest());
    assert.equal(result.schema, 'life-os.capability-manifest.v1');
    assert.equal(result.capabilities[0].id, 'identity.oauth');
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.capabilities), true);
  });

  it('rejects numeric, duplicate, or malformed capability identifiers', () => {
    for (const capabilities of [
      [capability({ id: '123' })],
      [capability({ id: 'Identity OAuth' })],
      [capability(), capability()]
    ]) {
      assert.throws(
        () => validateCapabilityManifest(manifest(capabilities)),
        /Invalid capability manifest/
      );
    }
  });

  it('rejects dependency cycles and unknown dependencies', () => {
    const first = capability({ id: 'identity.oauth', dependencies: ['identity.session'] });
    const second = capability({
      id: 'identity.session',
      dependencies: ['identity.oauth'],
      tracking_issue: null
    });
    assert.throws(
      () => validateCapabilityManifest(manifest([first, second])),
      /dependency cycle/
    );
    assert.throws(
      () =>
        validateCapabilityManifest(
          manifest([capability({ dependencies: ['missing.capability'] })])
        ),
      /unknown dependency/
    );
  });

  it('prevents documentation from masquerading as implementation or test evidence', () => {
    for (const evidence of [
      {
        maturity: 'production',
        kind: 'implementation',
        mode: 'exists',
        path: 'docs/oauth.md'
      },
      {
        maturity: 'production',
        kind: 'test',
        mode: 'exists',
        path: 'README.md'
      },
      {
        maturity: 'production',
        kind: 'documentation',
        mode: 'exists',
        path: 'apps/identity-service/src/main.ts'
      }
    ]) {
      assert.throws(
        () => validateCapabilityManifest(manifest([capability({ evidence: [evidence] })])),
        /evidence path/
      );
    }
  });

  it('rejects traversal, absolute paths, unsafe probes, and out-of-range scores', () => {
    const invalid = [
      capability({ evidence: [{ maturity: 'prototype', kind: 'implementation', mode: 'exists', path: '../secret' }] }),
      capability({ evidence: [{ maturity: 'prototype', kind: 'implementation', mode: 'exists', path: '/etc/passwd' }] }),
      capability({ evidence: [{ maturity: 'prototype', kind: 'implementation', mode: 'contains', path: 'apps/a.ts', value: '' }] }),
      capability({ customer_impact: 0 }),
      capability({ effort: 6 })
    ];
    for (const item of invalid) {
      assert.throws(
        () => validateCapabilityManifest(manifest([item])),
        /Invalid capability manifest/
      );
    }
  });
});

describe('validateCommercialReadinessPolicy', () => {
  it('accepts a strict policy with required workflows and commit statuses', () => {
    const policy = validateCommercialReadinessPolicy({
      schema: 'life-os.commercial-readiness-policy.v1',
      default_branch: 'main',
      readiness_issue_marker: '<!-- life-os-commercial-readiness-loop:v1 -->',
      readiness_issue_title: 'LifeOS commercial readiness',
      trusted_author_associations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
      required_workflows: ['CI', 'SAST Semgrep', 'Security Scan', 'AppGuardrail', 'Commercial Readiness'],
      required_statuses: ['CodeRabbit'],
      artifact_retention_days: 7,
      merge_method: 'squash'
    });
    assert.equal(policy.default_branch, 'main');
    assert.equal(Object.isFrozen(policy), true);
  });

  it('rejects policies that weaken required security gates or permit long retention', () => {
    const base = {
      schema: 'life-os.commercial-readiness-policy.v1',
      default_branch: 'main',
      readiness_issue_marker: '<!-- life-os-commercial-readiness-loop:v1 -->',
      readiness_issue_title: 'LifeOS commercial readiness',
      trusted_author_associations: ['OWNER'],
      required_workflows: ['CI', 'SAST Semgrep', 'Security Scan', 'AppGuardrail'],
      required_statuses: ['CodeRabbit'],
      artifact_retention_days: 7,
      merge_method: 'squash'
    };
    for (const policy of [
      { ...base, required_workflows: ['CI'] },
      { ...base, required_statuses: [] },
      { ...base, artifact_retention_days: 30 },
      { ...base, merge_method: 'merge' },
      { ...base, readiness_issue_marker: 'not-a-marker' }
    ]) {
      assert.throws(
        () => validateCommercialReadinessPolicy(policy),
        /Invalid commercial readiness policy/
      );
    }
  });
});

describe('validateGitHubSnapshot', () => {
  it('rejects raw review bodies, oversized collections, and malformed external references', async () => {
    const { validateGitHubSnapshot } = await import('./schema.mjs');
    const base = {
      schema: 'life-os.github-snapshot.v1',
      repository: 'ContextualWisdomLab/life-os',
      commit_sha: 'a'.repeat(40),
      generated_at: '2026-08-03T06:00:00.000Z',
      truncated: false,
      pull_requests: [],
      issues: []
    };
    assert.equal(validateGitHubSnapshot(base).repository, 'ContextualWisdomLab/life-os');
    assert.throws(
      () => validateGitHubSnapshot({ ...base, repository: 'https://evil.example/repo' }),
      /Invalid GitHub snapshot/
    );
    assert.throws(
      () =>
        validateGitHubSnapshot({
          ...base,
          pull_requests: [
            {
              number: 1,
              title: 'PR',
              state: 'open',
              draft: false,
              mergeable: true,
              mergeable_state: 'clean',
              base_ref: 'main',
              head_sha: 'a'.repeat(40),
              head_repo: 'ContextualWisdomLab/life-os',
              repository: 'ContextualWisdomLab/life-os',
              author_association: 'OWNER',
              behind_by: 0,
              reviews: [{ actor: 'reviewer', state: 'APPROVED', submitted_at: null, body: 'secret' }],
              unresolved_threads: 0,
              workflows: [],
              statuses: [],
              eligible: true,
              blockers: []
            }
          ]
        }),
      /Invalid GitHub snapshot/
    );
  });
});
