import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuditableProposal, ProposalRequest } from './proposal-service';
import {
  createProposalAuditRecord,
  createProposalDecisionEvent,
  type ProposalAuditRecord,
  type ProposalDecisionEvent,
} from './proposal-audit-domain';
import {
  type ProposalAuditSqlClient,
  type ProposalAuditSqlQueryResult,
  ProposalDecisionConflictError,
  ProposalDigestMismatchError,
  PostgresProposalAuditRepository,
} from './postgres-proposal-audit-repository';

const DATABASE_URL = process.env.AI_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

class PoolSqlClient implements ProposalAuditSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }
}

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('AI_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyMigration(pool: Pool): Promise<void> {
  const sql = await readFile(
    resolve(__dirname, '../migrations/0001_proposal_audit.sql'),
    'utf8',
  );
  await pool.query(sql);
}

function repository(pool: Pool): PostgresProposalAuditRepository {
  return new PostgresProposalAuditRepository(new PoolSqlClient(pool));
}

function request(taskId: string): ProposalRequest {
  return {
    objective: 'Ship a reviewable increment',
    context: [
      {
        id: taskId,
        kind: 'task',
        title: 'Verify the release candidate',
        status: 'active',
      },
    ],
  };
}

function proposal(
  workspaceId: string,
  proposalId: string,
  taskId: string,
  createdAt: string,
): AuditableProposal {
  return {
    proposalId,
    workspaceId,
    summary: 'Prioritize release verification.',
    rationale: ['The release candidate is the active critical path.'],
    operations: [
      {
        kind: 'prioritize_item',
        targetId: taskId,
        description: 'Prioritize release verification for explicit review.',
      },
    ],
    requiresConfirmation: true,
    createdAt,
  };
}

function auditRecord(
  workspaceId: string,
  proposalId = randomUUID(),
  taskId = randomUUID(),
  createdAt = '2026-08-04T00:00:00.000Z',
): ProposalAuditRecord {
  return createProposalAuditRecord({
    proposal: proposal(workspaceId, proposalId, taskId, createdAt),
    request: request(taskId),
    modelId: 'rule-based-v1',
    recordedAt: '2026-08-04T00:00:01.000Z',
  });
}

function decision(
  audit: ProposalAuditRecord,
  idempotencyKey: string,
  overrides: Partial<ProposalDecisionEvent> = {},
): ProposalDecisionEvent {
  return createProposalDecisionEvent({
    id: overrides.id ?? randomUUID(),
    workspaceId: audit.proposal.workspaceId,
    proposalId: audit.proposal.proposalId,
    proposalContentDigest:
      overrides.proposalContentDigest ?? audit.contentDigest,
    actorId: overrides.actorId ?? randomUUID(),
    decision: overrides.decision ?? 'accepted',
    ...(overrides.reason === undefined ? {} : { reason: overrides.reason }),
    idempotencyKey,
    decidedAt: overrides.decidedAt ?? '2026-08-04T00:00:02.000Z',
    recordedAt: overrides.recordedAt ?? '2026-08-04T00:00:03.000Z',
  });
}

describeWithPostgres('PostgreSQL proposal audit repository integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-ai-audit-integration-admin',
      max: 12,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS ai CASCADE');
    await applyMigration(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS ai CASCADE');
    await administrativePool.end();
  });

  it('preserves tenant-safe proposal evidence across pool restarts', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const first = auditRecord(
      workspaceId,
      '11111111-1111-4111-8111-111111111111',
      randomUUID(),
    );
    const second = auditRecord(
      workspaceId,
      '22222222-2222-4222-8222-222222222222',
      randomUUID(),
    );
    const privateRecord = auditRecord(otherWorkspaceId);
    const firstPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-ai-audit-first',
      max: 2,
    });
    const firstRepository = repository(firstPool);
    await firstRepository.saveProposal(second);
    await firstRepository.saveProposal(first);
    await firstRepository.saveProposal(privateRecord);
    await firstPool.end();

    const restartedPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-ai-audit-restarted',
      max: 2,
    });
    const restartedRepository = repository(restartedPool);
    await expect(
      restartedRepository.listProposals(workspaceId),
    ).resolves.toEqual([first, second]);
    await expect(
      restartedRepository.findProposal(
        workspaceId,
        privateRecord.proposal.proposalId,
      ),
    ).resolves.toBeUndefined();
    await restartedPool.end();
  });

  it('serializes concurrent exact decision replays into one audit event', async () => {
    const audit = auditRecord(randomUUID());
    const idempotencyKey = randomUUID();
    const actorId = randomUUID();
    const durableRepository = repository(administrativePool);
    await durableRepository.saveProposal(audit);

    const attempts = Array.from({ length: 12 }, (_, index) =>
      durableRepository.appendDecision(
        decision(audit, idempotencyKey, {
          actorId,
          recordedAt: new Date(
            Date.parse('2026-08-04T00:00:03.000Z') + index,
          ).toISOString(),
        }),
      ),
    );
    const results = await Promise.all(attempts);
    const history = await durableRepository.listDecisions(
      audit.proposal.workspaceId,
      audit.proposal.proposalId,
    );

    expect(history).toHaveLength(1);
    expect(results.every((event) => event.id === history[0]?.id)).toBe(true);
  });

  it('rejects stale digests and conflicting decision replays', async () => {
    const audit = auditRecord(randomUUID());
    const idempotencyKey = randomUUID();
    const actorId = randomUUID();
    const durableRepository = repository(administrativePool);
    await durableRepository.saveProposal(audit);

    await expect(
      durableRepository.appendDecision(
        decision(audit, randomUUID(), {
          actorId,
          proposalContentDigest: '0'.repeat(64),
        }),
      ),
    ).rejects.toBeInstanceOf(ProposalDigestMismatchError);

    await durableRepository.appendDecision(
      decision(audit, idempotencyKey, { actorId }),
    );
    await expect(
      durableRepository.appendDecision(
        decision(audit, idempotencyKey, {
          actorId,
          decision: 'rejected',
        }),
      ),
    ).rejects.toBeInstanceOf(ProposalDecisionConflictError);
    await expect(
      durableRepository.listDecisions(
        audit.proposal.workspaceId,
        audit.proposal.proposalId,
      ),
    ).resolves.toHaveLength(1);
  });

  it('rejects update, delete, and truncate across the audit ledger', async () => {
    const audit = auditRecord(randomUUID());
    const durableRepository = repository(administrativePool);
    await durableRepository.saveProposal(audit);
    const event = await durableRepository.appendDecision(
      decision(audit, randomUUID()),
    );

    await expect(
      administrativePool.query(
        'UPDATE ai.proposal_audit_records SET summary = $1 WHERE proposal_id = $2',
        ['Changed', audit.proposal.proposalId],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      administrativePool.query(
        'DELETE FROM ai.proposal_decision_events WHERE id = $1',
        [event.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      administrativePool.query('TRUNCATE ai.proposal_decision_events'),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      administrativePool.query('TRUNCATE ai.proposal_audit_records CASCADE'),
    ).rejects.toMatchObject({ code: '55000' });
  });
});
