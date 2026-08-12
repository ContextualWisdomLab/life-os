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

class ScriptedClient implements ProposalAuditSqlClient {
  readonly calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];

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
): Record<string, unknown> {
  return {
    contractVersion: 'life-os.data-rights-contributor.v1',
    operation,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
    ...(operation === 'erase' ? { idempotencyKey: IDEMPOTENCY_KEY } : {}),
  };
}

function exportResult(
  proposals: unknown = [],
  decisions: unknown = [],
): ProposalAuditSqlQueryResult<unknown> {
  return {
    rows: [
      {
        proposal_audit_records: proposals,
        proposal_decision_events: decisions,
      },
    ],
  };
}

async function expectDataRightsFailure(
  contributor: AiDataRightsContributor,
  value: unknown,
): Promise<void> {
  await expect(contributor.handle(value)).rejects.toBeInstanceOf(AiDataRightsError);
}

describe('AiDataRightsContributor', () => {
  it('exports deterministic bounded AI evidence without destructive idempotency keys', async () => {
    const nullPrototype = Object.assign(Object.create(null), { zeta: 'z' });
    const client = new ScriptedClient([
      exportResult(
        [
          {
            proposalId: WORKSPACE_ID,
            request: {
              alpha: null,
              enabled: true,
              disabled: false,
              count: 1,
              nested: ['value'],
              nullPrototype,
            },
          },
        ],
        [],
      ),
    ]);
    const contributor = new AiDataRightsContributor(client);

    const response = await contributor.handle(request('export'));

    expect(response).toMatchObject({
      contributor: 'ai.service',
      operation: 'export',
      requestId: REQUEST_ID,
      schemaVersion: 'ai.data-rights.v1',
      recordCount: 1,
    });
    if (response.operation !== 'export') throw new Error('Expected export response');
    expect(response.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, 1_001]);
    expect(client.calls[0]?.text).toContain('ORDER BY created_at ASC, proposal_id ASC');
    expect(client.calls[0]?.text).toContain('ORDER BY recorded_at ASC, id ASC');
    expect(client.calls[0]?.text).not.toContain('idempotency_key');
  });

  it('dispatches preflight, erase, and both verification outcomes', async () => {
    const client = new ScriptedClient([
      { rows: [{ erasure_receipts_ready: true, erasure_function_ready: true }] },
      { rows: [{ erased_records: 3, receipt_sha256: SHA256 }] },
      { rows: [{ record_count: 0 }] },
      { rows: [{ record_count: 2 }] },
    ]);
    const contributor = new AiDataRightsContributor(client);

    await expect(contributor.handle(request('erase_preflight'))).resolves.toEqual({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'ai.service',
      operation: 'erase_preflight',
      requestId: REQUEST_ID,
      ready: true,
      blockers: [],
    });
    await expect(contributor.handle(request('erase'))).resolves.toEqual({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'ai.service',
      operation: 'erase',
      requestId: REQUEST_ID,
      erasedRecords: 3,
      receiptSha256: SHA256,
    });
    await expect(contributor.handle(request('verify_erased'))).resolves.toMatchObject({
      operation: 'verify_erased',
      erased: true,
    });
    await expect(contributor.handle(request('verify_erased'))).resolves.toMatchObject({
      operation: 'verify_erased',
      erased: false,
    });
    expect(client.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      USER_ID,
      REQUEST_ID,
      IDEMPOTENCY_KEY,
    ]);
  });

  it('reports all unavailable destructive privileges', async () => {
    const contributor = new AiDataRightsContributor(
      new ScriptedClient([
        { rows: [{ erasure_receipts_ready: false, erasure_function_ready: false }] },
      ]),
    );
    await expect(contributor.handle(request('erase_preflight'))).resolves.toMatchObject({
      ready: false,
      blockers: [
        'ai_erasure_receipt_privileges_unavailable',
        'ai_erasure_function_unavailable',
      ],
    });
  });

  it('rejects malformed request envelopes before persistence access', async () => {
    const client = new ScriptedClient([]);
    const contributor = new AiDataRightsContributor(client);
    const nullPrototypeRequest = Object.assign(Object.create(null), request('export'));
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
      { ...request('erase'), idempotencyKey: 'not-a-uuid' },
    ];
    for (const value of malformed) await expectDataRightsFailure(contributor, value);
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

  it('rejects missing duplicate and sparse result evidence', async () => {
    for (const result of [
      { rows: [] },
      { rows: [{}, {}] },
      { rows: new Array(1) },
    ] as ProposalAuditSqlQueryResult<unknown>[]) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(new ScriptedClient([result])),
        request('export'),
      );
    }
  });

  it('requires both export aggregates and enforces total record bounds', async () => {
    for (const result of [exportResult({}, []), exportResult([], {})]) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(new ScriptedClient([result])),
        request('export'),
      );
    }
    await expectDataRightsFailure(
      new AiDataRightsContributor(
        new ScriptedClient([
          exportResult(Array.from({ length: 1_001 }, () => null), []),
        ]),
      ),
      request('export'),
    );
  });

  it('rejects malformed or unbounded JSON evidence', async () => {
    let tooDeep: unknown = null;
    for (let depth = 0; depth < 18; depth += 1) tooDeep = [tooDeep];
    const tooManyObjectEntries = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, index) => [`key${index}`, null]),
    );
    const invalidValues: unknown[] = [
      [{ value: Number.POSITIVE_INFINITY }],
      ['x'.repeat(64 * 1024 + 1)],
      [Array.from({ length: 2_001 }, () => null)],
      [tooManyObjectEntries],
      [{ ['k'.repeat(257)]: null }],
      [new Date(0)],
      [undefined],
      [tooDeep],
    ];
    for (const proposals of invalidValues) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(
          new ScriptedClient([exportResult(proposals, [])]),
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
        result: { rows: [{ erasure_receipts_ready: 'true', erasure_function_ready: true }] },
      },
      {
        requestValue: request('erase_preflight'),
        result: { rows: [{ erasure_receipts_ready: true, erasure_function_ready: 1 }] },
      },
      { requestValue: request('verify_erased'), result: { rows: [{ record_count: '0' }] } },
      { requestValue: request('verify_erased'), result: { rows: [{ record_count: 1.5 }] } },
      { requestValue: request('verify_erased'), result: { rows: [{ record_count: -1 }] } },
      { requestValue: request('erase'), result: { rows: [{ erased_records: 0, receipt_sha256: 42 }] } },
      { requestValue: request('erase'), result: { rows: [{ erased_records: 0, receipt_sha256: 'bad' }] } },
    ];
    for (const current of cases) {
      await expectDataRightsFailure(
        new AiDataRightsContributor(new ScriptedClient([current.result])),
        current.requestValue,
      );
    }
  });
});
