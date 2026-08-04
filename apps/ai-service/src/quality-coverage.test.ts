import { createHmac } from 'node:crypto';
import { HttpException, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AiBootstrapApplication,
  AiProposalAuditController,
  AiProposalController,
  bootstrapAiService,
  createAiApplication,
  resolveAiServicePort,
} from './main';
import {
  ProposalAuditApplication,
  ProposalAuditNotFoundError,
  validateProposalDecisionRequest,
} from './proposal-audit-application';
import {
  computeProposalContentDigest,
  computeProposalRequestDigest,
  createProposalAuditRecord,
  createProposalDecisionEvent,
  type ProposalAuditRecord,
  ProposalAuditValidationError,
  ProposalDecisionEvent,
  ProposalDigestMismatchError,
  validateProposalAuditRecord,
  validateProposalDecisionEvent,
} from './proposal-audit-domain';
import {
  type ProposalAuditSqlClient,
  type ProposalAuditSqlQueryResult,
  ProposalAuditPersistenceError,
  ProposalDecisionConflictError,
  PostgresProposalAuditRepository,
} from './postgres-proposal-audit-repository';
import {
  type AuditableProposal,
  type ProposalModel,
  type ProposalModelDraft,
  type ProposalRequest,
  ProposalService,
  ProposalValidationError,
  RuleBasedProposalModel,
  validateProposalRequest,
} from './proposal-service';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';
const OTHER_EVENT_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_ACTOR_ID = '88888888-8888-4888-8888-888888888888';
const GATEWAY_SECRET = Buffer.alloc(32, 0x51).toString('base64url');

/** Exact signed headers accepted by one method-and-path-bound controller call. */
interface SignedControllerContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly issuedAt: string;
  readonly signature: string;
}

/** Signs fresh service context for one controller-owned route. */
function signedControllerContext(
  method: 'GET' | 'POST',
  path: string,
): SignedControllerContext {
  const issuedAt = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.ai-context.v1\n${WORKSPACE_ID}\n${ACTOR_ID}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
  return {
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    issuedAt,
    signature,
  };
}

function request(overrides: Partial<ProposalRequest> = {}): ProposalRequest {
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
    ...overrides,
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

function auditRecord(
  proposalOverrides: Partial<AuditableProposal> = {},
): ProposalAuditRecord {
  return createProposalAuditRecord({
    proposal: proposal(proposalOverrides),
    request: request(),
    modelId: 'rule-based-v1',
    recordedAt: '2026-08-04T00:00:01.000Z',
  });
}

function decisionEvent(
  overrides: Partial<ProposalDecisionEvent> = {},
): ProposalDecisionEvent {
  const audit = auditRecord();
  return createProposalDecisionEvent({
    id: overrides.id ?? EVENT_ID,
    workspaceId: overrides.workspaceId ?? WORKSPACE_ID,
    proposalId: overrides.proposalId ?? PROPOSAL_ID,
    proposalContentDigest:
      overrides.proposalContentDigest ?? audit.contentDigest,
    actorId: overrides.actorId ?? ACTOR_ID,
    decision: overrides.decision ?? 'accepted',
    ...(overrides.reason === undefined ? {} : { reason: overrides.reason }),
    idempotencyKey: overrides.idempotencyKey ?? IDEMPOTENCY_KEY,
    decidedAt: overrides.decidedAt ?? '2026-08-04T00:00:02.000Z',
    recordedAt: overrides.recordedAt ?? '2026-08-04T00:00:03.000Z',
  });
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  const audit = auditRecord();
  return {
    proposal_id: audit.proposal.proposalId,
    workspace_id: audit.proposal.workspaceId,
    model_id: audit.modelId,
    request_json: audit.request,
    request_digest: audit.requestDigest,
    summary: audit.proposal.summary,
    rationale_json: audit.proposal.rationale,
    operations_json: audit.proposal.operations,
    requires_confirmation: true,
    content_digest: audit.contentDigest,
    created_at: new Date(audit.proposal.createdAt),
    recorded_at: new Date(audit.recordedAt),
    ...overrides,
  };
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  const event = decisionEvent();
  return {
    id: event.id,
    workspace_id: event.workspaceId,
    proposal_id: event.proposalId,
    proposal_content_digest: event.proposalContentDigest,
    actor_id: event.actorId,
    decision_kind: event.decision,
    reason_text: event.reason ?? null,
    idempotency_key: event.idempotencyKey,
    decided_at: new Date(event.decidedAt),
    recorded_at: new Date(event.recordedAt),
    ...overrides,
  };
}

interface ErrorResponse {
  readonly error: unknown;
}

type SqlResponse = unknown[] | ErrorResponse;

class SequencedSqlClient implements ProposalAuditSqlClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  private readonly responses: SqlResponse[];

  constructor(...responses: SqlResponse[]) {
    this.responses = [...responses];
  }

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.responses.shift() ?? [];
    if (!Array.isArray(response)) {
      throw response.error;
    }
    return { rows: [...response] as Row[] };
  }
}

function staticModel(draft: ProposalModelDraft): ProposalModel {
  return {
    async generate(): Promise<ProposalModelDraft> {
      return draft;
    },
  };
}

async function expectProblem(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(status);
    expect(exception.getResponse()).toMatchObject({ status, code });
    return;
  }
  throw new Error(`Expected HTTP problem ${status}/${code}`);
}

function throwingApplication(error: unknown): ProposalAuditApplication {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return {
    generateProposal: fail,
    listProposals: fail,
    findProposal: fail,
    listDecisions: fail,
    appendDecision: fail,
  } as unknown as ProposalAuditApplication;
}

describe('proposal service exhaustive boundary evidence', () => {
  it('accepts every supported context kind and status', () => {
    const kinds = ['goal', 'project', 'milestone', 'task', 'habit'] as const;
    const statuses = ['active', 'blocked', 'completed'] as const;
    for (const kind of kinds) {
      for (const status of statuses) {
        expect(
          validateProposalRequest({
            objective: 'Review every supported branch',
            context: [
              { id: TASK_ID, kind, title: `${kind}-${status}`, status },
            ],
          }).context[0],
        ).toMatchObject({ kind, status });
      }
    }
  });

  it.each([
    null,
    [],
    42,
    { objective: 'x', different: [] },
    { objective: 'x', context: 'not-an-array' },
    { objective: 'x', context: Array.from({ length: 201 }, () => ({})) },
    { objective: 42, context: [] },
    { objective: ' ', context: [] },
    { objective: 'x'.repeat(2_001), context: [] },
    {
      objective: 'x',
      context: [{ id: TASK_ID, kind: 'unknown', title: 'x', status: 'active' }],
    },
    {
      objective: 'x',
      context: [{ id: TASK_ID, kind: 'task', title: 'x', status: 'unknown' }],
    },
    {
      objective: 'x',
      context: [{ id: TASK_ID, kind: 'task', title: 42, status: 'active' }],
    },
    {
      objective: 'x',
      context: [{ id: TASK_ID, kind: 'task', title: ' ', status: 'active' }],
    },
    {
      objective: 'x',
      context: [
        {
          id: TASK_ID,
          kind: 'task',
          title: 'x'.repeat(1_001),
          status: 'active',
        },
      ],
    },
    {
      objective: 'x',
      context: [{ id: 42, kind: 'task', title: 'x', status: 'active' }],
    },
  ])('rejects malformed proposal request %#', (value) => {
    expect(() => validateProposalRequest(value)).toThrow(
      ProposalValidationError,
    );
  });

  it('validates every operation shape and rejects malformed model output', async () => {
    const validDraft: ProposalModelDraft = {
      summary: 'Valid summary',
      rationale: ['Valid rationale'],
      operations: [
        { kind: 'create_task', description: 'Create a task' },
        {
          kind: 'prioritize_item',
          description: 'Prioritize a task',
          targetId: TASK_ID,
        },
        {
          kind: 'schedule_item',
          description: 'Schedule a task',
          targetId: TASK_ID,
        },
      ],
    };
    await expect(
      new ProposalService(
        staticModel(validDraft),
        () => new Date('2026-08-04T00:00:00.000Z'),
        () => PROPOSAL_ID,
      ).generateProposal(WORKSPACE_ID, request()),
    ).resolves.toMatchObject({ operations: validDraft.operations });

    const invalidDrafts: ProposalModelDraft[] = [
      { ...validDraft, summary: 42 },
      { ...validDraft, summary: ' ' },
      { ...validDraft, summary: 'x'.repeat(1_001) },
      { ...validDraft, rationale: 'not-an-array' },
      { ...validDraft, rationale: [] },
      { ...validDraft, rationale: Array.from({ length: 21 }, () => 'x') },
      { ...validDraft, rationale: [42] },
      { ...validDraft, operations: 'not-an-array' },
      { ...validDraft, operations: [] },
      {
        ...validDraft,
        operations: Array.from({ length: 21 }, () => ({
          kind: 'create_task',
          description: 'x',
        })),
      },
      {
        ...validDraft,
        operations: [{ kind: 'delete_item', description: 'x' }],
      },
      {
        ...validDraft,
        operations: [{ kind: 'create_task', targetId: TASK_ID }],
      },
      {
        ...validDraft,
        operations: [{ kind: 'create_task', description: 42 }],
      },
      {
        ...validDraft,
        operations: [
          { kind: 'prioritize_item', description: 'x', targetId: 'invalid' },
        ],
      },
    ];
    for (const draft of invalidDrafts) {
      await expect(
        new ProposalService(staticModel(draft)).generateProposal(
          WORKSPACE_ID,
          request(),
        ),
      ).rejects.toBeInstanceOf(ProposalValidationError);
    }
  });

  it('rejects invalid clock and identifier factories', async () => {
    await expect(
      new ProposalService(
        new RuleBasedProposalModel(),
        () => new Date(Number.NaN),
      ).generateProposal(WORKSPACE_ID, request()),
    ).rejects.toBeInstanceOf(ProposalValidationError);
    await expect(
      new ProposalService(
        new RuleBasedProposalModel(),
        () => new Date('2026-08-04T00:00:00.000Z'),
        () => 'invalid',
      ).generateProposal(WORKSPACE_ID, request()),
    ).rejects.toBeInstanceOf(ProposalValidationError);
  });
});

describe('proposal audit domain exhaustive evidence', () => {
  it('canonicalizes operations with and without targets and accepts Date rows', () => {
    const noTarget = proposal({
      operations: [{ kind: 'create_task', description: 'Create the task' }],
      createdAt: new Date('2026-08-04T00:00:00.000Z') as unknown as string,
    });
    const requestDigest = computeProposalRequestDigest(WORKSPACE_ID, request());
    expect(
      computeProposalContentDigest(noTarget, 'rule-based-v1', requestDigest),
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(
      createProposalAuditRecord({
        proposal: noTarget,
        request: request(),
        modelId: 'rule-based-v1',
        recordedAt: new Date('2026-08-04T00:00:01.000Z') as unknown as string,
      }),
    ).toMatchObject({
      proposal: { createdAt: '2026-08-04T00:00:00.000Z' },
      recordedAt: '2026-08-04T00:00:01.000Z',
    });
  });

  it.each([null, [], 42, { other: 'x', context: [] }])(
    'rejects malformed audit requests %#',
    (value) => {
      expect(() =>
        computeProposalRequestDigest(
          WORKSPACE_ID,
          value as unknown as ProposalRequest,
        ),
      ).toThrow(ProposalAuditValidationError);
    },
  );

  it('rejects every malformed proposal evidence family', () => {
    const digest = computeProposalRequestDigest(WORKSPACE_ID, request());
    const invalidProposals: unknown[] = [
      null,
      [],
      { ...proposal(), createdAt: undefined, other: 'x' },
      { ...proposal(), rationale: 'not-an-array' },
      { ...proposal(), rationale: [] },
      { ...proposal(), rationale: Array.from({ length: 21 }, () => 'x') },
      { ...proposal(), operations: 'not-an-array' },
      { ...proposal(), operations: [] },
      {
        ...proposal(),
        operations: Array.from({ length: 21 }, () => ({
          kind: 'create_task',
          description: 'x',
        })),
      },
      { ...proposal(), requiresConfirmation: false },
      { ...proposal(), proposalId: 42 },
      { ...proposal(), workspaceId: 'invalid' },
      { ...proposal(), summary: 42 },
      { ...proposal(), summary: ' ' },
      { ...proposal(), summary: 'x'.repeat(1_001) },
      { ...proposal(), rationale: [42] },
      { ...proposal(), operations: [null] },
      {
        ...proposal(),
        operations: [{ kind: 'create_task', targetId: TASK_ID }],
      },
      {
        ...proposal(),
        operations: [{ kind: 'delete_item', description: 'x' }],
      },
      {
        ...proposal(),
        operations: [{ kind: 'create_task', description: 42 }],
      },
      {
        ...proposal(),
        operations: [
          { kind: 'schedule_item', description: 'x', targetId: 'invalid' },
        ],
      },
      { ...proposal(), createdAt: new Date(Number.NaN) },
      { ...proposal(), createdAt: 42 },
      { ...proposal(), createdAt: 'tomorrow' },
      { ...proposal(), createdAt: '2026-13-01T00:00:00Z' },
    ];
    for (const value of invalidProposals) {
      expect(() =>
        computeProposalContentDigest(
          value as AuditableProposal,
          'rule-based-v1',
          digest,
        ),
      ).toThrow(ProposalAuditValidationError);
    }
    for (const modelId of [42, ' ', 'x'.repeat(201)]) {
      expect(() =>
        computeProposalContentDigest(proposal(), modelId as string, digest),
      ).toThrow(ProposalAuditValidationError);
    }
    for (const value of [42, 'invalid']) {
      expect(() =>
        computeProposalContentDigest(
          proposal(),
          'rule-based-v1',
          value as string,
        ),
      ).toThrow(ProposalAuditValidationError);
    }
  });

  it('rejects malformed audit records and decision events at every timestamp branch', () => {
    const audit = auditRecord();
    const invalidAuditValues: unknown[] = [
      null,
      [],
      { ...audit, recordedAt: undefined, other: 'x' },
      { ...audit, requestDigest: 'invalid' },
      { ...audit, contentDigest: '0'.repeat(64) },
      { ...audit, recordedAt: new Date(Number.NaN) },
      { ...audit, recordedAt: 42 },
      { ...audit, recordedAt: 'tomorrow' },
      { ...audit, recordedAt: '2026-13-01T00:00:00Z' },
    ];
    for (const value of invalidAuditValues) {
      expect(() => validateProposalAuditRecord(value)).toThrow(
        ProposalAuditValidationError,
      );
    }

    expect(() =>
      createProposalDecisionEvent({
        ...decisionEvent(),
        decision: 'applied' as 'accepted',
      }),
    ).toThrow(ProposalAuditValidationError);
    expect(() =>
      createProposalDecisionEvent({
        ...decisionEvent(),
        decidedAt: new Date(Number.NaN) as unknown as string,
      }),
    ).toThrow(ProposalAuditValidationError);
    expect(
      createProposalDecisionEvent({
        ...decisionEvent(),
        decidedAt: new Date('2026-08-04T00:00:02.000Z') as unknown as string,
      }),
    ).not.toHaveProperty('reason');

    const invalidDecisionValues: unknown[] = [
      null,
      [],
      { ...decisionEvent(), recordedAt: undefined, other: 'x' },
      { ...decisionEvent(), decision: 'applied' },
      { ...decisionEvent(), proposalContentDigest: 42 },
      { ...decisionEvent(), reason: 42 },
      { ...decisionEvent(), decidedAt: '2026-13-01T00:00:00Z' },
    ];
    for (const value of invalidDecisionValues) {
      expect(() => validateProposalDecisionEvent(value)).toThrow(
        ProposalAuditValidationError,
      );
    }
  });
});

describe('proposal audit application residual validation', () => {
  it.each([
    {
      expectedContentDigest: 'a'.repeat(64),
      idempotencyKey: IDEMPOTENCY_KEY,
      decision: 'accepted',
      decidedAt: '2026-13-01T00:00:00Z',
    },
    {
      expectedContentDigest: 'a'.repeat(64),
      idempotencyKey: IDEMPOTENCY_KEY,
      decision: 'accepted',
      reason: 42,
      decidedAt: '2026-08-04T00:00:00Z',
    },
  ])('rejects semantically invalid decision input %#', (value) => {
    expect(() => validateProposalDecisionRequest(value)).toThrow(
      ProposalAuditValidationError,
    );
  });

  it('covers non-Date clocks and decisions without a reason', async () => {
    const repository = {
      records: [auditRecord()],
      async saveProposal(): Promise<void> {},
      async findProposal(): Promise<ProposalAuditRecord | undefined> {
        return this.records[0];
      },
      async listProposals(): Promise<ProposalAuditRecord[]> {
        return this.records;
      },
      async appendDecision(event: ProposalDecisionEvent) {
        return event;
      },
      async listDecisions(): Promise<ProposalDecisionEvent[]> {
        return [];
      },
    };
    const badClock = new ProposalAuditApplication(
      new ProposalService(new RuleBasedProposalModel()),
      repository,
      'rule-based-v1',
      () => 'not-a-date' as unknown as Date,
    );
    await expect(
      badClock.generateProposal(WORKSPACE_ID, request()),
    ).rejects.toBeInstanceOf(ProposalAuditValidationError);

    const service = new ProposalAuditApplication(
      new ProposalService(
        new RuleBasedProposalModel(),
        () => new Date('2026-08-04T00:00:00Z'),
        () => PROPOSAL_ID,
      ),
      repository,
      'rule-based-v1',
      () => new Date('2026-08-04T00:00:01Z'),
      () => EVENT_ID,
    );
    await expect(
      service.appendDecision(WORKSPACE_ID, PROPOSAL_ID, ACTOR_ID, {
        expectedContentDigest: repository.records[0]!.contentDigest,
        idempotencyKey: IDEMPOTENCY_KEY,
        decision: 'rejected',
        decidedAt: '2026-08-04T00:00:02Z',
      }),
    ).resolves.not.toHaveProperty('reason');
  });
});

describe('PostgreSQL proposal audit residual safety branches', () => {
  it('rejects invalid string identifiers, duplicate rows, and row identity drift', async () => {
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient(),
      ).listProposals('invalid'),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([proposalRow(), proposalRow()]),
      ).findProposal(WORKSPACE_ID, PROPOSAL_ID),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([proposalRow({ proposal_id: OTHER_EVENT_ID })]),
      ).findProposal(WORKSPACE_ID, PROPOSAL_ID),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([]),
      ).findProposal(WORKSPACE_ID, PROPOSAL_ID),
    ).resolves.toBeUndefined();
  });

  it('maps malformed inputs, rows, and SQL transport failures', async () => {
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient(),
      ).saveProposal({} as ProposalAuditRecord),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient(),
      ).appendDecision({} as ProposalDecisionEvent),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient({ error: new Error('transport detail') }),
      ).listProposals(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([proposalRow({ content_digest: 'invalid' })]),
      ).listProposals(WORKSPACE_ID),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([decisionRow({ decision_kind: 'applied' })]),
      ).listDecisions(WORKSPACE_ID, PROPOSAL_ID),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
  });

  it('requires exactly one inserted or replayed decision row', async () => {
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([]),
      ).appendDecision(decisionEvent()),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);

    const uniqueError = {
      error: {
        code: '23505',
        constraint: 'proposal_decision_events_idempotency_unique',
      },
    };
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient(uniqueError, []),
      ).appendDecision(decisionEvent()),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient(uniqueError, [decisionRow(), decisionRow()]),
      ).appendDecision(decisionEvent()),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
  });

  it('validates every persisted decision identity and reason shape', async () => {
    const invalidRows = [
      decisionRow({ workspace_id: OTHER_WORKSPACE_ID }),
      decisionRow({ proposal_id: OTHER_EVENT_ID }),
      decisionRow({ decision_kind: 'applied' }),
    ];
    for (const row of invalidRows) {
      await expect(
        new PostgresProposalAuditRepository(
          new SequencedSqlClient([row]),
        ).listDecisions(WORKSPACE_ID, PROPOSAL_ID),
      ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    }

    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([
          decisionRow({ idempotency_key: OTHER_EVENT_ID }),
        ]),
      ).appendDecision(decisionEvent()),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);

    await expect(
      new PostgresProposalAuditRepository(
        new SequencedSqlClient([
          decisionRow({ reason_text: undefined }),
          decisionRow({ reason_text: 'Reviewed' }),
        ]),
      ).listDecisions(WORKSPACE_ID, PROPOSAL_ID),
    ).resolves.toEqual([
      decisionEvent(),
      decisionEvent({ reason: 'Reviewed' }),
    ]);
  });

  it('rejects each non-identical idempotency replay field', async () => {
    const uniqueError = {
      error: {
        code: '23505',
        constraint: 'proposal_decision_events_idempotency_unique',
      },
    };
    const attempted = decisionEvent({ reason: 'Reviewed' });
    const mismatches = [
      decisionRow({
        proposal_content_digest: 'a'.repeat(64),
        reason_text: 'Reviewed',
      }),
      decisionRow({ actor_id: OTHER_ACTOR_ID, reason_text: 'Reviewed' }),
      decisionRow({ decision_kind: 'rejected', reason_text: 'Reviewed' }),
      decisionRow({ reason_text: 'Different' }),
      decisionRow({
        reason_text: 'Reviewed',
        decided_at: new Date('2026-08-04T00:00:04.000Z'),
      }),
    ];
    for (const row of mismatches) {
      await expect(
        new PostgresProposalAuditRepository(
          new SequencedSqlClient(uniqueError, [row]),
        ).appendDecision(attempted),
      ).rejects.toBeInstanceOf(ProposalDecisionConflictError);
    }
  });

  it('maps primitive and mismatched database errors without leaking details', async () => {
    for (const error of [
      'transport-secret',
      {
        code: 'XX000',
        constraint: 'proposal_decision_events_idempotency_unique',
      },
    ]) {
      await expect(
        new PostgresProposalAuditRepository(
          new SequencedSqlClient({ error }),
        ).appendDecision(decisionEvent()),
      ).rejects.toEqual(new ProposalAuditPersistenceError());
    }
  });
});

describe('AI controllers and bootstrap error contracts', () => {
  beforeEach(() => {
    vi.stubEnv('AI_GATEWAY_CONTEXT_SECRET', GATEWAY_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('covers health, successful generation, and all generation failures', async () => {
    const generated = proposal();
    const generator = {
      generateProposal: vi.fn().mockResolvedValue(generated),
    };
    const controller = new AiProposalController(generator);
    const proposalContext = signedControllerContext('POST', '/v1/proposals');
    expect(controller.health()).toEqual({
      status: 'ok',
      service: 'ai-service',
    });
    await expect(
      controller.createProposal(
        proposalContext.workspaceId,
        proposalContext.actorId,
        proposalContext.issuedAt,
        proposalContext.signature,
        request(),
      ),
    ).resolves.toEqual(generated);

    await expectProblem(
      controller.createProposal(
        undefined,
        proposalContext.actorId,
        proposalContext.issuedAt,
        proposalContext.signature,
        request(),
      ),
      401,
      'invalid_gateway_context',
    );
    await expectProblem(
      controller.createProposal(
        proposalContext.workspaceId,
        proposalContext.actorId,
        proposalContext.issuedAt,
        proposalContext.signature,
        null,
      ),
      400,
      'invalid_request',
    );
    for (const [error, status, code] of [
      [new ProposalAuditValidationError(), 400, 'invalid_request'],
      [new ProposalAuditPersistenceError(), 503, 'audit_unavailable'],
      [new Error('secret'), 503, 'proposal_unavailable'],
      ['secret', 503, 'proposal_unavailable'],
    ] as const) {
      await expectProblem(
        new AiProposalController({
          async generateProposal(): Promise<AuditableProposal> {
            throw error;
          },
        }).createProposal(
          proposalContext.workspaceId,
          proposalContext.actorId,
          proposalContext.issuedAt,
          proposalContext.signature,
          request(),
        ),
        status,
        code,
      );
    }
  });

  it('covers successful audit calls and missing trusted headers', async () => {
    const audit = auditRecord();
    const event = decisionEvent();
    const application = {
      listProposals: vi.fn().mockResolvedValue([audit]),
      findProposal: vi.fn().mockResolvedValue(audit),
      listDecisions: vi.fn().mockResolvedValue([event]),
      appendDecision: vi.fn().mockResolvedValue(event),
    } as unknown as ProposalAuditApplication;
    const controller = new AiProposalAuditController(application);
    const listContext = signedControllerContext('GET', '/v1/proposals');
    const proposalPath = `/v1/proposals/${PROPOSAL_ID}`;
    const detailContext = signedControllerContext('GET', proposalPath);
    const decisionsPath = `${proposalPath}/decisions`;
    const decisionsReadContext = signedControllerContext('GET', decisionsPath);
    const decisionsWriteContext = signedControllerContext(
      'POST',
      decisionsPath,
    );

    await expect(
      controller.listProposals(
        listContext.workspaceId,
        listContext.actorId,
        listContext.issuedAt,
        listContext.signature,
      ),
    ).resolves.toEqual([audit]);
    await expect(
      controller.findProposal(
        detailContext.workspaceId,
        detailContext.actorId,
        detailContext.issuedAt,
        detailContext.signature,
        PROPOSAL_ID,
      ),
    ).resolves.toEqual(audit);
    await expect(
      controller.listDecisions(
        decisionsReadContext.workspaceId,
        decisionsReadContext.actorId,
        decisionsReadContext.issuedAt,
        decisionsReadContext.signature,
        PROPOSAL_ID,
      ),
    ).resolves.toEqual([event]);
    await expect(
      controller.appendDecision(
        decisionsWriteContext.workspaceId,
        decisionsWriteContext.actorId,
        decisionsWriteContext.issuedAt,
        decisionsWriteContext.signature,
        PROPOSAL_ID,
        {
          expectedContentDigest: audit.contentDigest,
          idempotencyKey: IDEMPOTENCY_KEY,
          decision: 'accepted',
          decidedAt: '2026-08-04T00:00:02Z',
        },
      ),
    ).resolves.toEqual(event);

    await expectProblem(
      controller.listProposals(
        undefined,
        listContext.actorId,
        listContext.issuedAt,
        listContext.signature,
      ),
      401,
      'invalid_gateway_context',
    );
    await expectProblem(
      controller.findProposal(
        undefined,
        detailContext.actorId,
        detailContext.issuedAt,
        detailContext.signature,
        PROPOSAL_ID,
      ),
      401,
      'invalid_gateway_context',
    );
    await expectProblem(
      controller.listDecisions(
        undefined,
        decisionsReadContext.actorId,
        decisionsReadContext.issuedAt,
        decisionsReadContext.signature,
        PROPOSAL_ID,
      ),
      401,
      'invalid_gateway_context',
    );
    await expectProblem(
      controller.appendDecision(
        undefined,
        decisionsWriteContext.actorId,
        decisionsWriteContext.issuedAt,
        decisionsWriteContext.signature,
        PROPOSAL_ID,
        {},
      ),
      401,
      'invalid_gateway_context',
    );
    await expectProblem(
      controller.appendDecision(
        decisionsWriteContext.workspaceId,
        undefined,
        decisionsWriteContext.issuedAt,
        decisionsWriteContext.signature,
        PROPOSAL_ID,
        {},
      ),
      401,
      'invalid_gateway_context',
    );
  });

  it('maps every audit application failure without credential details', async () => {
    const logger = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const cases: Array<[unknown, number, string]> = [
      [new ProposalValidationError(), 400, 'invalid_request'],
      [new ProposalAuditValidationError(), 400, 'invalid_request'],
      [new ProposalAuditNotFoundError(), 404, 'proposal_not_found'],
      [new ProposalDigestMismatchError(), 409, 'stale_proposal'],
      [new ProposalDecisionConflictError(), 409, 'idempotency_conflict'],
      [new ProposalAuditPersistenceError(), 503, 'audit_unavailable'],
      [new Error('password=secret'), 503, 'audit_unavailable'],
      ['password=secret', 503, 'audit_unavailable'],
    ];
    const listContext = signedControllerContext('GET', '/v1/proposals');
    for (const [error, status, code] of cases) {
      await expectProblem(
        new AiProposalAuditController(throwingApplication(error)).listProposals(
          listContext.workspaceId,
          listContext.actorId,
          listContext.issuedAt,
          listContext.signature,
        ),
        status,
        code,
      );
    }
    const loggedOutput = logger.mock.calls
      .flat()
      .flatMap((value) =>
        value instanceof Error
          ? [value.name, value.message, value.stack ?? '']
          : [typeof value === 'string' ? value : JSON.stringify(value)],
      )
      .join('\n');
    expect(loggedOutput).not.toContain('password=secret');
    logger.mockRestore();
  });

  it('validates service ports and boots through an injected application', async () => {
    expect(resolveAiServicePort(undefined)).toBe(4_105);
    expect(resolveAiServicePort('   ')).toBe(4_105);
    expect(resolveAiServicePort('1')).toBe(1);
    expect(resolveAiServicePort('65535')).toBe(65_535);
    for (const value of ['0', '65536', '1.5', 'not-a-port']) {
      expect(() => resolveAiServicePort(value)).toThrow(
        'AI service port is invalid',
      );
    }

    const application: AiBootstrapApplication = {
      enableShutdownHooks: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
    };
    await bootstrapAiService(
      { AI_SERVICE_PORT: '4321' },
      async () => application,
    );
    expect(application.enableShutdownHooks).toHaveBeenCalledOnce();
    expect(application.listen).toHaveBeenCalledWith(4_321, '0.0.0.0');
  });

  it('creates the default Nest application through the production module', async () => {
    const application: AiBootstrapApplication = {
      enableShutdownHooks: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi
      .spyOn(NestFactory, 'create')
      .mockResolvedValue(application as never);
    await expect(createAiApplication()).resolves.toBe(application);
    factory.mockRestore();
  });
});
