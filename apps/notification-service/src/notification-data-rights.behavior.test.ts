import { describe, expect, it } from 'vitest';
import {
  NotificationDataRightsContributor,
  NotificationDataRightsError,
} from './notification-data-rights';
import type {
  NotificationSqlClient,
  NotificationSqlQueryResult,
} from './postgres-reminder-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const SHA256 = 'a'.repeat(64);
const CODEPOINT_CANONICAL_DIGEST =
  '3ab3b13cd6c0ab42b9cbed3c685c5b4d0b065f94b5e147b267a3ab4e00f0d356';

class ScriptedClient implements NotificationSqlClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  constructor(
    private readonly script: Array<NotificationSqlQueryResult<unknown> | Error>,
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    const next = this.script.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (next === undefined) {
      throw new Error('test script exhausted');
    }
    return next as NotificationSqlQueryResult<Row>;
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
  reminderOccurrences: unknown = [],
  reminderOutcomes: unknown = [],
  inboxMessages: unknown = [],
): NotificationSqlQueryResult<unknown> {
  return {
    rows: [
      {
        reminder_occurrences: reminderOccurrences,
        reminder_outcomes: reminderOutcomes,
        inbox_messages: inboxMessages,
      },
    ],
  };
}

async function expectDataRightsFailure(
  contributor: NotificationDataRightsContributor,
  value: unknown,
): Promise<void> {
  await expect(contributor.handle(value)).rejects.toBeInstanceOf(
    NotificationDataRightsError,
  );
}

describe('NotificationDataRightsContributor', () => {
  it('exports bounded deterministic tenant evidence without secret hash columns', async () => {
    const nullPrototype = Object.assign(Object.create(null), { zeta: 'z' });
    const client = new ScriptedClient([
      exportResult(
        [
          {
            zeta: 'last',
            alpha: null,
            enabled: true,
            disabled: false,
            count: 1,
            nested: ['value'],
            nullPrototype,
          },
        ],
        [],
        [],
      ),
    ]);
    const contributor = new NotificationDataRightsContributor(client);

    const response = await contributor.handle(request('export'));

    expect(response).toMatchObject({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'notification.service',
      operation: 'export',
      requestId: REQUEST_ID,
      schemaVersion: 'notification.data-rights.v1',
      recordCount: 1,
    });
    if (response.operation !== 'export') {
      throw new Error('Expected export response');
    }
    expect(response.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, 1_001]);
    expect(client.calls[0]?.text).toContain(
      'ORDER BY created_at ASC, reminder_id ASC',
    );
    expect(client.calls[0]?.text).toContain(
      'ORDER BY occurred_at ASC, outcome_id ASC',
    );
    expect(client.calls[0]?.text).toContain(
      'ORDER BY delivered_at ASC, message_id ASC',
    );
    expect(client.calls[0]?.text).not.toContain('claim_key_hash');
    expect(client.calls[0]?.text).not.toContain('idempotency_key_hash');
  });

  it('uses codepoint-stable canonical JSON for reproducible export evidence', async () => {
    const first = new NotificationDataRightsContributor(
      new ScriptedClient([
        exportResult([{ a: 'lower', Z: 'upper' }], [], []),
      ]),
    );
    const second = new NotificationDataRightsContributor(
      new ScriptedClient([
        exportResult([{ Z: 'upper', a: 'lower' }], [], []),
      ]),
    );

    const firstResponse = await first.handle(request('export'));
    const secondResponse = await second.handle(request('export'));

    if (
      firstResponse.operation !== 'export' ||
      secondResponse.operation !== 'export'
    ) {
      throw new Error('Expected export responses');
    }
    expect(firstResponse.sha256).toBe(CODEPOINT_CANONICAL_DIGEST);
    expect(secondResponse.sha256).toBe(CODEPOINT_CANONICAL_DIGEST);
  });

  it('dispatches every contributor lifecycle operation with tenant-scoped parameters', async () => {
    const client = new ScriptedClient([
      { rows: [{ erasure_function_ready: true }] },
      { rows: [{ erased_records: 3, receipt_sha256: SHA256 }] },
      { rows: [{ record_count: 0 }] },
      { rows: [{ record_count: 2 }] },
    ]);
    const contributor = new NotificationDataRightsContributor(client);

    await expect(
      contributor.handle(request('erase_preflight')),
    ).resolves.toEqual({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'notification.service',
      operation: 'erase_preflight',
      requestId: REQUEST_ID,
      ready: true,
      blockers: [],
    });
    await expect(contributor.handle(request('erase'))).resolves.toEqual({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'notification.service',
      operation: 'erase',
      requestId: REQUEST_ID,
      erasedRecords: 3,
      receiptSha256: SHA256,
    });
    await expect(
      contributor.handle(request('verify_erased')),
    ).resolves.toMatchObject({
      operation: 'verify_erased',
      erased: true,
      requestId: REQUEST_ID,
    });
    await expect(
      contributor.handle(request('verify_erased')),
    ).resolves.toMatchObject({
      operation: 'verify_erased',
      erased: false,
      requestId: REQUEST_ID,
    });
    expect(client.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      USER_ID,
      REQUEST_ID,
      IDEMPOTENCY_KEY,
    ]);
    expect(client.calls[2]?.values).toEqual([WORKSPACE_ID]);
  });

  it('requires only function execution authority for erasure preflight', async () => {
    const client = new ScriptedClient([
      { rows: [{ erasure_function_ready: false }] },
    ]);
    const contributor = new NotificationDataRightsContributor(client);

    await expect(
      contributor.handle(request('erase_preflight')),
    ).resolves.toEqual({
      contractVersion: 'life-os.data-rights-contributor.v1',
      contributor: 'notification.service',
      operation: 'erase_preflight',
      requestId: REQUEST_ID,
      ready: false,
      blockers: ['notification_erasure_function_unavailable'],
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('has_function_privilege');
    expect(client.calls[0]?.text).not.toContain('has_table_privilege');
    expect(client.calls[0]?.text).not.toContain(
      'data_rights_erasure_receipts',
    );
  });

  it('rejects malformed request envelopes before persistence access', async () => {
    const client = new ScriptedClient([]);
    const contributor = new NotificationDataRightsContributor(client);
    const nullPrototypeRequest = Object.assign(
      Object.create(null),
      request('export'),
    );
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

    for (const value of malformed) {
      await expectDataRightsFailure(contributor, value);
    }
    expect(client.calls).toEqual([]);
  });

  it('sanitizes database failures without leaking driver details', async () => {
    const client = new ScriptedClient([
      new Error('postgresql://administrator:secret@database.example.test'),
    ]);
    const contributor = new NotificationDataRightsContributor(client);

    let failure: unknown;
    try {
      await contributor.handle(request('export'));
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(NotificationDataRightsError);
    if (!(failure instanceof Error)) {
      throw new Error('Expected notification data-rights error');
    }
    expect(failure.message).toBe('Notification data-rights operation failed');
  });

  it('rejects missing, duplicate, or sparse SQL result evidence', async () => {
    const cases: NotificationSqlQueryResult<unknown>[] = [
      { rows: [] },
      { rows: [{}, {}] },
      { rows: new Array(1) },
    ];
    for (const result of cases) {
      const contributor = new NotificationDataRightsContributor(
        new ScriptedClient([result]),
      );
      await expectDataRightsFailure(contributor, request('export'));
    }
  });

  it('requires all three export aggregates to be arrays', async () => {
    const cases = [
      exportResult({}, [], []),
      exportResult([], {}, []),
      exportResult([], [], {}),
    ];
    for (const result of cases) {
      const contributor = new NotificationDataRightsContributor(
        new ScriptedClient([result]),
      );
      await expectDataRightsFailure(contributor, request('export'));
    }
  });

  it('fails closed when a bounded export exceeds its total record ceiling', async () => {
    const contributor = new NotificationDataRightsContributor(
      new ScriptedClient([
        exportResult(Array.from({ length: 1_001 }, () => null)),
      ]),
    );
    await expectDataRightsFailure(contributor, request('export'));
  });

  it('rejects malformed or unbounded JSON returned by PostgreSQL', async () => {
    let tooDeep: unknown = null;
    for (let depth = 0; depth < 18; depth += 1) {
      tooDeep = [tooDeep];
    }
    const tooManyObjectEntries = Object.fromEntries(
      Array.from({ length: 2_001 }, (_, index) => [`key${index}`, null]),
    );
    const nullPrototype = Object.assign(Object.create(null), { safe: 'value' });
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

    for (const reminderOccurrences of invalidValues) {
      const contributor = new NotificationDataRightsContributor(
        new ScriptedClient([
          exportResult(reminderOccurrences, [nullPrototype], []),
        ]),
      );
      await expectDataRightsFailure(contributor, request('export'));
    }
  });

  it('rejects malformed privilege, count, and receipt evidence', async () => {
    const cases: Array<{
      readonly requestValue: Record<string, unknown>;
      readonly result: NotificationSqlQueryResult<unknown>;
    }> = [
      {
        requestValue: request('erase_preflight'),
        result: { rows: [{ erasure_function_ready: 1 }] },
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
        result: {
          rows: [{ erased_records: 0, receipt_sha256: 'not-a-digest' }],
        },
      },
    ];

    for (const current of cases) {
      const contributor = new NotificationDataRightsContributor(
        new ScriptedClient([current.result]),
      );
      await expectDataRightsFailure(contributor, current.requestValue);
    }
  });
});
