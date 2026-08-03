import { describe, expect, it } from 'vitest';
import type { AuditableProposal, ProposalRequest } from './proposal-service';
import {
  computeProposalContentDigest,
  computeProposalRequestDigest,
  createProposalAuditRecord,
  createProposalDecisionEvent,
  ProposalAuditValidationError,
  validateProposalAuditRecord,
  validateProposalDecisionEvent,
} from './proposal-audit-domain';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';

function request(): ProposalRequest {
  return {
    objective: 'Ship a reviewable increment',
    context: [
      {
        id: TASK_ID,
        kind: 'task',
        title: 'Verify the release candidate',
        status: 'active',
      },
    ],
  };
}

function proposal(
  overrides: Partial<AuditableProposal> = {},
): AuditableProposal {
  return {
    proposalId: PROPOSAL_ID,
    workspaceId: WORKSPACE_ID,
    summary: 'Prioritize release verification.',
    rationale: ['The release candidate is the active critical path.'],
    operations: [
      {
        kind: 'prioritize_item',
        targetId: TASK_ID,
        description: 'Prioritize release verification for explicit review.',
      },
    ],
    requiresConfirmation: true,
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('proposal audit domain', () => {
  it('creates deterministic frozen request and content digests', () => {
    const first = createProposalAuditRecord({
      proposal: proposal(),
      request: request(),
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });
    const second = createProposalAuditRecord({
      proposal: proposal(),
      request: request(),
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:02.000Z',
    });

    expect(first.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.requestDigest).toBe(second.requestDigest);
    expect(first.contentDigest).toBe(second.contentDigest);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.proposal)).toBe(true);
    expect(Object.isFrozen(first.request.context)).toBe(true);
    expect(computeProposalRequestDigest(WORKSPACE_ID, request())).toBe(
      first.requestDigest,
    );
    expect(
      computeProposalContentDigest(
        proposal(),
        'rule-based-v1',
        first.requestDigest,
      ),
    ).toBe(first.contentDigest);
  });

  it('changes only the content digest when proposal content changes', () => {
    const original = createProposalAuditRecord({
      proposal: proposal(),
      request: request(),
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });
    const changed = createProposalAuditRecord({
      proposal: proposal({ summary: 'Create a different task.' }),
      request: request(),
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });

    expect(changed.requestDigest).toBe(original.requestDigest);
    expect(changed.contentDigest).not.toBe(original.contentDigest);
  });

  it('rejects tampered persisted evidence', () => {
    const record = createProposalAuditRecord({
      proposal: proposal(),
      request: request(),
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });

    expect(() =>
      validateProposalAuditRecord({
        ...record,
        contentDigest: '0'.repeat(64),
      }),
    ).toThrow(ProposalAuditValidationError);
    expect(() =>
      validateProposalAuditRecord({
        ...record,
        proposal: { ...record.proposal, workspaceId: '42' },
      }),
    ).toThrow(ProposalAuditValidationError);
  });

  it('normalizes and validates append-only decisions', () => {
    const audit = createProposalAuditRecord({
      proposal: proposal(),
      request: request(),
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });
    const decision = createProposalDecisionEvent({
      id: EVENT_ID,
      workspaceId: WORKSPACE_ID,
      proposalId: PROPOSAL_ID,
      proposalContentDigest: audit.contentDigest,
      actorId: ACTOR_ID,
      decision: 'accepted',
      reason: '  Approved after review  ',
      idempotencyKey: IDEMPOTENCY_KEY,
      decidedAt: '2026-08-04T09:00:00+09:00',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });

    expect(decision.reason).toBe('Approved after review');
    expect(decision.decidedAt).toBe('2026-08-04T00:00:00.000Z');
    expect(validateProposalDecisionEvent(decision)).toEqual(decision);
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('rejects numeric identifiers and malformed decision digests', () => {
    expect(() =>
      createProposalDecisionEvent({
        id: '1',
        workspaceId: WORKSPACE_ID,
        proposalId: PROPOSAL_ID,
        proposalContentDigest: 'not-a-digest',
        actorId: ACTOR_ID,
        decision: 'rejected',
        idempotencyKey: IDEMPOTENCY_KEY,
        decidedAt: '2026-08-04T00:00:00.000Z',
        recordedAt: '2026-08-04T00:00:01.000Z',
      }),
    ).toThrow(ProposalAuditValidationError);
  });
});
