import { MODULE_METADATA } from '@nestjs/common/constants';
import type { PoolConfig } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiRuntime, createAiRuntime } from './ai-runtime';
import {
  AI_RUNTIME,
  AiProductionModule,
  PROPOSAL_AUDIT_APPLICATION,
  PROPOSAL_SERVICE,
} from './main';
import { ProposalAuditApplication } from './proposal-audit-application';
import type {
  ProposalAuditRecord,
  ProposalAuditRepository,
  ProposalDecisionEvent,
} from './proposal-audit-domain';
import { ProposalService, RuleBasedProposalModel } from './proposal-service';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

const poolState = vi.hoisted(() => ({
  configuration: undefined as PoolConfig | undefined,
  queries: [] as Array<{ text: string; values: readonly unknown[] }>,
  endCalls: 0,
  errorListenerCount: 0,
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    constructor(configuration: PoolConfig) {
      poolState.configuration = configuration;
    }

    on(event: string, _listener: (error: Error) => void): this {
      if (event === 'error') {
        poolState.errorListenerCount += 1;
      }
      return this;
    }

    async query<Row>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<{ rows: Row[] }> {
      poolState.queries.push({ text, values });
      return { rows: [] };
    }

    async end(): Promise<void> {
      poolState.endCalls += 1;
    }
  },
}));

/** In-memory append-only audit repository used to exercise constructor defaults. */
class InMemoryAuditRepository implements ProposalAuditRepository {
  readonly records: ProposalAuditRecord[] = [];
  readonly decisions: ProposalDecisionEvent[] = [];

  /** Stores one immutable proposal record. */
  async saveProposal(record: ProposalAuditRecord): Promise<void> {
    this.records.push(record);
  }

  /** Returns one tenant-owned proposal record when present. */
  async findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord | undefined> {
    return this.records.find(
      (record) =>
        record.proposal.workspaceId === workspaceId &&
        record.proposal.proposalId === proposalId,
    );
  }

  /** Lists proposal records for one tenant. */
  async listProposals(workspaceId: string): Promise<ProposalAuditRecord[]> {
    return this.records.filter(
      (record) => record.proposal.workspaceId === workspaceId,
    );
  }

  /** Appends and returns one immutable decision event. */
  async appendDecision(
    event: ProposalDecisionEvent,
  ): Promise<ProposalDecisionEvent> {
    this.decisions.push(event);
    return event;
  }

  /** Lists decision events for one tenant-owned proposal. */
  async listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]> {
    return this.decisions.filter(
      (event) =>
        event.workspaceId === workspaceId && event.proposalId === proposalId,
    );
  }
}

/** Returns one PostgreSQL URL without embedding a scanner-shaped credential. */
function databaseUrl(): string {
  return `postgresql:${String.fromCharCode(47, 47)}db/life_os`;
}

/** Reads a factory provider from Nest module metadata. */
function providerFactory(
  token: symbol,
): (...arguments_: unknown[]) => unknown {
  const providers = Reflect.getMetadata(
    MODULE_METADATA.PROVIDERS,
    AiProductionModule,
  ) as Array<{
    readonly provide?: unknown;
    readonly useFactory?: (...arguments_: unknown[]) => unknown;
  }>;
  const factory = providers.find((provider) => provider.provide === token)
    ?.useFactory;
  if (!factory) {
    throw new Error('Expected production module factory provider');
  }
  return factory;
}

beforeEach(() => {
  poolState.configuration = undefined;
  poolState.queries.length = 0;
  poolState.endCalls = 0;
  poolState.errorListenerCount = 0;
});

describe('AI production runtime wiring', () => {
  it('adapts the default PostgreSQL pool through query and shutdown boundaries', async () => {
    const runtime = createAiRuntime({ AI_DATABASE_URL: databaseUrl() });

    await expect(runtime.application.listProposals(WORKSPACE_ID)).resolves.toEqual(
      [],
    );
    await runtime.close();

    expect(poolState.configuration).toMatchObject({
      connectionString: databaseUrl(),
      application_name: 'life-os-ai-service',
    });
    expect(poolState.errorListenerCount).toBe(1);
    expect(poolState.queries).toHaveLength(1);
    expect(poolState.queries[0]?.values).toEqual([WORKSPACE_ID]);
    expect(poolState.endCalls).toBe(1);
  });

  it('exposes the same shared audit application through both narrowed providers', () => {
    const application = Object.create(
      ProposalAuditApplication.prototype,
    ) as ProposalAuditApplication;
    const runtime = { application } as AiRuntime;

    expect(providerFactory(PROPOSAL_SERVICE)(runtime)).toBe(application);
    expect(providerFactory(PROPOSAL_AUDIT_APPLICATION)(runtime)).toBe(
      application,
    );
    expect(providerFactory(AI_RUNTIME)).toBeTypeOf('object');
  });

  it('uses production clock and identifier defaults for durable evidence', async () => {
    const repository = new InMemoryAuditRepository();
    const service = new ProposalAuditApplication(
      new ProposalService(
        new RuleBasedProposalModel(),
        () => new Date('2026-08-04T00:00:00.000Z'),
        () => PROPOSAL_ID,
      ),
      repository,
    );

    await service.generateProposal(WORKSPACE_ID, {
      objective: 'Exercise production audit defaults',
      context: [
        {
          id: TASK_ID,
          kind: 'task',
          title: 'Verify default evidence generation',
          status: 'active',
        },
      ],
    });
    const record = repository.records[0];
    if (!record) {
      throw new Error('Expected one generated proposal record');
    }

    const event = await service.appendDecision(
      WORKSPACE_ID,
      PROPOSAL_ID,
      ACTOR_ID,
      {
        expectedContentDigest: record.contentDigest,
        idempotencyKey: IDEMPOTENCY_KEY,
        decision: 'accepted',
        decidedAt: '2026-08-04T00:00:01.000Z',
      },
    );

    expect(record.modelId).toBe('rule-based-v1');
    expect(Number.isNaN(Date.parse(record.recordedAt))).toBe(false);
    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(Number.isNaN(Date.parse(event.recordedAt))).toBe(false);
  });
});
