import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  renderCommercialReadinessIssue,
  sanitizeUntrustedText,
} from './render.mjs';

const OPENAI_TOKEN_PREFIX = ['s', 'k', '-'].join('');
const GITHUB_TOKEN_PREFIX = ['g', 'h', 'p', '_'].join('');
const SCRIPT_TAG = ['<', 'script', '>'].join('');
const SYNTHETIC_OPENAI_TOKEN = `${OPENAI_TOKEN_PREFIX}${'a'.repeat(40)}`;
const SYNTHETIC_GITHUB_TOKEN = `${GITHUB_TOKEN_PREFIX}${'b'.repeat(40)}`;

const report = {
  schema: 'life-os.commercial-readiness-report.v1',
  generated_at: '2026-08-03T06:00:00.000Z',
  commit_sha: 'a'.repeat(40),
  summary: {
    total_capabilities: 2,
    at_target: 1,
    unresolved_gaps: 1,
    weighted_maturity_percent: 50,
  },
  capabilities: [],
  gaps: [
    {
      capability_id: 'identity.oauth',
      outcome: 'Users can sign in.',
      observed_maturity: 'prototype',
      target_maturity: 'production',
      priority_score: 240,
      tracking_issue: 18,
      missing_evidence: ['apps/identity-service/src/main.ts'],
    },
  ],
};

const snapshot = {
  schema: 'life-os.github-snapshot.v1',
  repository: 'ContextualWisdomLab/life-os',
  commit_sha: 'a'.repeat(40),
  generated_at: '2026-08-03T06:00:00.000Z',
  pull_requests: [
    {
      number: 7,
      title: `evil ](javascript:alert(1)) ${SCRIPT_TAG} ${SYNTHETIC_OPENAI_TOKEN} @ContextualWisdomLab/security`,
      eligible: false,
      blockers: ['workflow-not-successful:CI'],
    },
  ],
  issues: [],
};

describe('sanitizeUntrustedText', () => {
  it('redacts credentials, escapes control text, and neutralizes mentions', () => {
    const value = sanitizeUntrustedText(
      `name *x* ${SCRIPT_TAG} ${SYNTHETIC_GITHUB_TOKEN} @example-team`,
    );
    assert.equal(value.includes(SCRIPT_TAG), false);
    assert.equal(value.includes(GITHUB_TOKEN_PREFIX), false);
    assert.equal(value.includes('*x*'), false);
    assert.equal(value.includes('@example-team'), false);
    assert.equal(value.includes('\\[redacted\\]'), true);
    assert.match(value, /@\u200bexample-team/);
  });
});

describe('renderCommercialReadinessIssue', () => {
  it('renders one stable marker and no raw review bodies, credentials, or active mentions', () => {
    const markdown = renderCommercialReadinessIssue(report, snapshot, {
      marker: '<!-- life-os-commercial-readiness-loop:v1 -->',
      maxGaps: 10,
    });
    assert.equal(
      markdown.match(/life-os-commercial-readiness-loop:v1/g)?.length,
      1,
    );
    assert.match(markdown, /identity\.oauth/);
    assert.match(markdown, /#18/);
    assert.equal(markdown.includes(SCRIPT_TAG), false);
    assert.equal(markdown.includes(OPENAI_TOKEN_PREFIX), false);
    assert.equal(markdown.includes('javascript:alert'), false);
    assert.equal(markdown.includes('@ContextualWisdomLab/security'), false);
    assert.match(markdown, /@\u200bContextualWisdomLab\/security/);
  });

  it('is deterministic for the same report and snapshot', () => {
    const options = {
      marker: '<!-- life-os-commercial-readiness-loop:v1 -->',
      maxGaps: 10,
    };
    assert.equal(
      renderCommercialReadinessIssue(report, snapshot, options),
      renderCommercialReadinessIssue(report, snapshot, options),
    );
  });
});
