import { describe, expect, it } from 'vitest';
import { AiDataRightsContributor, AiDataRightsError } from './ai-data-rights';
import type {
  ProposalAuditSqlClient,
  ProposalAuditSqlQueryResult,
} from './postgres-proposal-audit-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const SHA256 = 'a'.repeat(64);
const EVIDENCE_TIME = '2026-08-12T00:00:00.000000Z';
const EXPECTED_EXPORT_SHA256 =
  '5a9727df670dc4d6e2a367e2a2ba001385836f8ebd2b2e67a1928b0988ad1f4a';

class ScriptedClient implements ProposalAuditSqlClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  constructor(
    private readonly script: Array<ProposalAuditSqlQueryResult<unknown> | Error>,
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    const next = this.script.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('test script exhausted');
    return next as ProposalAuditSqlQueryResult<Row>;
  }
}

function request(
  operation: 'export' | 'erase_preflight' | 'erase' | 'verify_erased',
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    contractVersion: 'life-os.data-rights-contributor.v1',
    operation,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
    ...(operation === 'erase' ? { idempotencyKey: IDEMPOTENCY_KEY } : {}),
    ...overrides,
  };
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function evidence(
  data: unknown,
  index = 1,
  kind: 'decision' | 'proposal' = 'proposal',
  evidenceTime = EVIDENCE_TIME,
): Record<string, unknown> {
  return {
    evidenceTime,
    evidenceKind: kind,
    evidenceId: uuid(index),
    data,
  };
}

function exportResult(
  evidenceRecords: unknown,
): ProposalAuditSqlQueryResult<unknown> {
  return { rows: [{ evidence_records: evidenceRecords }] };
}

async function expectDataRightsFailure(
  contributor: AiDataRightsContributor,
  value: unknown,
): Promise<void> {
  await expect(contributor.handle(value)).rejects.toBeInstanceOf(
    AiDataRightsError,
  );
}

describe('AiDataRightsContributor', () => {
  it('exports deterministic bounded AI evidence without destructive idempotency keys', async () => {
    const nullPrototype = Object.assign(Object.create(null), { zeta: 'z' });
    const proposal = {
      proposalId: WORKSPACE_ID,
      request: {
        alpha: null,
        enabled: true,
        disabled: false,
        count: 1,
        nested: ['value'],
        nullPrototype,
      },
    };
    const client = new ScriptedClient([
      exportResult([evidence(proposal)]),
      exportResult([
        evidence({
          request: {
            nullPrototype: Object.assign(Object.create(null), { zeta: 'z' }),
            nested: ['value'],
            count: 1,
            disabled: false,
            enabled: true,
            alpha: null,
          },
          proposalId: WORKSPACE_ID,
        }),
      ]),
    ]);
    const contributor = new AiDataRightsContributor(client);

    const response = await contributor.handle(request('export'));
    const reordered = await contributor.handle(request('export'));

    expect(response).toMatchObject({
      contributor: 'ai.service',
      operation: 'export',
      requestId: REQUEST_ID,
      schemaVersion: 'ai.data-rights.v1',
      recordCount: 1,
      sha256: EXPECTED_EXPORT_SHA256,
    });
    if (response.operation !== 'export' || reordered.operation !== 'export') {
      throw new Error('Expected export responses');
    }
    expect(response.sha256).toBe(EXPECTED_EXPORT_SHA256);
    expect(reordered.sha256).toBe(response.sha256);
    expect(response.nextCursor).toBeUndefined();
    expect(client.calls[0]?.values).toEqual([
      WORKSPACE_ID,
      null,
      null,
      null,
      1_001,
    ]);
    expect(client.calls[0]?.text).toContain(
      'ORDER BY evidence_time ASC, evidence_kind ASC, evidence_id ASC',
    );
    expect(client.calls[0]?.text).not.toContain('idempotency_key');
  });

  it('paginates large valid workspaces with an opaque deterministic keyset cursor', async () => {
    const firstPage = Array.from({ length: 1_001 }, (_, index) =>
      evidence(
        { proposalId: uuid(index + 1), request: { index } },
        index + 1,
      ),
    );
    const finalRecord = evidence(
      { proposalId: uuid(1_001), request: { index: 1_000 } },
      1_001,
    );
    const client = new ScriptedClient([
      exportResult(firstPage),
      exportResult([finalRecord]),
    ]);
    const contributor = new AiDataRightsContributor(client);

    const first = await contributor.handle(request('export'));
    if (first.operation !== 'export' || first.nextCursor === undefined) {
      throw new Error('Expected paginated export response');
    }
    expect(first.recordCount).toBe(1_000);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    const final = await contributor.handle(
      request('export', { cursor: first.nextCursor }),
    );
    if (final.operation !== 'export') throw new Error('Expected final export');
    expect(final.recordCount).toBe(1);
    expect(final.nextCursor).toBeUndefined();
    expect(client.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      EVIDENCE_TIME,
      'proposal',
      uuid(1_000),
      1_001,
    ]);
  });

  it('dispatches preflight, erase, and both verification outcomes', async () => {
    const client = new ScriptedClient([
      { rows: [{ erasure_function_ready: true }] },
      { rows: [{ erased_records: 3, receipt_sha256: SHA256 }] },
      { rows: [{ record_count: 0 }] },
      { rows: [{ record_count: 2 }] },
    ]);
    const contributor = new AiDataRightsContributor(client);

    await expect(contributor.handle(request('erase_preflight'))).resolves.toEqual(
      {
        contractVersion: 'life-os.data-rights-contributor.v1',
        contributor: 'ai.service',
        operation: 'erase_preflight',
        requestId: REQUEST_ID,
        ready: true,
        blockers: [],
      },
    );
    await expect(contributor.handle(request('erase'))).resolves.toEqual({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'ai.service',
      operation: 'erase',
      requestId: REQUEST_ID,
      erasedRecords: 3,
      receiptSha256: SHA256,
    });
    await expect(
      contributor.handle(request('verify_erased')),
    ).resolves.toMatchObject({ operation: 'verify_erased', erased: true });
    await expect(
      contributor.handle(request('verify_erased')),
    ).resolves.toMatchObject({ operation: 'verify_erased', erased: false });
    expect(client.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      USER_ID,
      REQUEST_ID,
      IDEMPOTENCY_KEY,
    ]);
  });

  it('reports unavailable owner-controlled erasure execution', async () => {
    const contributor = new AiDataRightsContributor(
      new ScriptedClient([
        { rows: [{ erasure_function_ready: false }] },
      ]),
    );
    await expect(
      contributor.handle(request('erase_preflight')),
    ).resolves.toMatchObject({
      ready: false,
      blockers: ['ai_erasure_function_unavailable'],
    });
  });

  it('rejects malformed request envelopes before persistence access', async () => {
    const client = new ScriptedClient([]);
    const contributor = new AiDataRightsContributor(client);
    const nullPrototypeRequest = Object.assign(
      Object.create(null),
      request('export'),
    );
    const malformedCursor = Buffer.from(
      JSON.stringify({
        version: 'wrong',
        evidenceTime: EVIDENCE_TIME,
        evidenceKind: 'proposal',
        evidenceId: uuid(1),
      }),
      'utf8',
    ).toString('base64url');
    const malformed = [
      undefined,
      null,
      [],
      nullPrototypeRequest,
      { ...request('export'), contractVersion: 'wrong' },
      { ...request('export'), operation: 'unknown' },
      { ...request('export'), extra: true },
      { ...request('export'), workspaceId: 42 },
      { ...request('export'), workspaceId: 'not-a-uuid' },
      { ...request('export'), cursor: '' },
      { ...request('export'), cursor: '***' },
      { ...request('export'), cursor: malformedCursor },
      { ...request('erase'), idempotencyKey: 'not-a-uuid' },
    ];
    for (const value of malformed) {
      await expectDataRightsFailure(contributor, value);
    }
    expect(client.calls).toEqual([]);
  });

  it('sanitizes database failures', async () => {
    const contributor = new AiDataRightsContributor(
      new ScriptedClient([new Error('postgresql://admin:secret@db')]),
    );
    const failure = contributor.handle(request('export'));
    await expect(failure).rejects.toBeInstanceOf(AiDataRightsError);
    await expect(failure).rejects.toThrowError('AI data-rights operation failed');
  });

  it('rejects missing duplicate sparse and malformed aggregate evidence', async () => {
    for (const result of [
      { rows: [] },
      { rows: [{}, {}] },
      { rows: new Array(1) },
      { rows: [{ evidence_records: {} }] },
      exportResult(Array.from({ length: 1_002 }, () => null)),
    ] as ProposalAuditSqlQueryResult<unknown>[]) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(new ScriptedClient([result])),
        request('export'),
      );
    }
  });

  it('rejects malformed cross-table evidence identities', async () => {
    const malformed = [
      { ...evidence({}), evidenceKind: 'unknown' },
      { ...evidence({}), evidenceTime: 'not-an-instant' },
      { ...evidence({}), evidenceId: 'not-a-uuid' },
      { ...evidence({}), extra: true },
    ];
    for (const value of malformed) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(
          new ScriptedClient([exportResult([value])]),
        ),
        request('export'),
      );
    }
  });

  it('rejects malformed or unbounded JSON evidence', async () => {
    let tooDeep: unknown = null;
    for (let depth = 0; depth < 18; depth += 1) tooDeep = [tooDeep];
    const tooManyObjectEntries = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, index) => [`key${index}`, null]),
    );
    const invalidValues: unknown[] = [
      { value: Number.POSITIVE_INFINITY },
      'x'.repeat(64 * 1024 + 1),
      Array.from({ length: 2_001 }, () => null),
      tooManyObjectEntries,
      { ['k'.repeat(257)]: null },
      new Date(0),
      undefined,
      tooDeep,
    ];
    for (const data of invalidValues) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(
          new ScriptedClient([exportResult([evidence(data)])]),
        ),
        request('export'),
      );
    }
  });

  it('rejects malformed privilege count and receipt evidence', async () => {
    const cases: Array<{
      readonly requestValue: Record<string, unknown>;
      readonly result: ProposalAuditSqlQueryResult<unknown>;
    }> = [
      {
        requestValue: request('erase_preflight'),
        result: { rows: [{ erasure_function_ready: 'true' }] },
      },
      {
        requestValue: request('verify_erased'),
        result: { rows: [{ record_count: '0' }] },
      },
      {
        requestValue: request('verify_erased'),
        result: { rows: [{ record_count: 1.5 }] },
      },
      {
        requestValue: request('verify_erased'),
        result: { rows: [{ record_count: -1 }] },
      },
      {
        requestValue: request('erase'),
        result: { rows: [{ erased_records: 0, receipt_sha256: 42 }] },
      },
      {
        requestValue: request('erase'),
        result: { rows: [{ erased_records: 0, receipt_sha256: 'bad' }] },
      },
    ];
    for (const current of cases) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(new ScriptedClient([current.result])),
        current.requestValue,
      );
    }
  });
});
