import { describe, expect, it } from 'vitest';
import {
  NotificationDataRightsContributor,
  type NotificationDataRightsResponse,
} from './notification-data-rights';
import type {
  NotificationSqlClient,
  NotificationSqlQueryResult,
} from './postgres-reminder-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const EVIDENCE_TIME = '2026-08-12T00:00:00.000000Z';

class ScriptedClient implements NotificationSqlClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  constructor(
    private readonly script: Array<NotificationSqlQueryResult<unknown>>,
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    this.calls.push({ text, values: [...values] });
    const next = this.script.shift();
    if (next === undefined) {
      throw new Error('test script exhausted');
    }
    return next as NotificationSqlQueryResult<Row>;
  }
}

function exportRequest(cursor?: string): Record<string, unknown> {
  return {
    contractVersion: 'life-os.data-rights-contributor.v1',
    operation: 'export',
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function reminderEvidence(index: number): Record<string, unknown> {
  const evidenceId = `11111111-1111-4111-8111-${index
    .toString(16)
    .padStart(12, '0')}`;
  return {
    evidenceTime: EVIDENCE_TIME,
    evidenceKind: 'reminder_occurrence',
    evidenceId,
    data: {
      reminderId: evidenceId,
      title: `Reminder ${index}`,
      dueAt: '2026-08-12T01:00:00.000000Z',
      timeZone: 'UTC',
      quietStartMinute: null,
      quietEndMinute: null,
      dailyDeliveryLimit: 3,
      deliveryAttemptCount: 0,
      status: 'pending',
      claimExpiresAt: null,
      createdAt: EVIDENCE_TIME,
      updatedAt: EVIDENCE_TIME,
    },
  };
}

function exportPage(
  records: readonly Record<string, unknown>[],
): NotificationSqlQueryResult<unknown> {
  return { rows: [{ evidence_records: [...records] }] };
}

function requireExport(
  response: NotificationDataRightsResponse,
): Extract<NotificationDataRightsResponse, { readonly operation: 'export' }> {
  if (response.operation !== 'export') {
    throw new Error('Expected export response');
  }
  return response;
}

describe('Notification data-rights export pagination', () => {
  it('returns a continuation cursor instead of making portability unavailable past 1000 records', async () => {
    const firstPageRows = Array.from({ length: 1_001 }, (_, index) =>
      reminderEvidence(index),
    );
    const finalRecord = reminderEvidence(1_001);
    const client = new ScriptedClient([
      exportPage(firstPageRows),
      exportPage([finalRecord]),
    ]);
    const contributor = new NotificationDataRightsContributor(client);

    const first = requireExport(await contributor.handle(exportRequest()));
    expect(first.recordCount).toBe(1_000);
    expect(first.data).toMatchObject({
      reminderOccurrences: expect.any(Array),
      reminderOutcomes: [],
      inboxMessages: [],
    });
    expect(first).toHaveProperty('nextCursor');
    const nextCursor = (first as typeof first & { readonly nextCursor: string })
      .nextCursor;
    expect(nextCursor).toMatch(/^[A-Za-z0-9_-]+$/u);

    const second = requireExport(
      await contributor.handle(exportRequest(nextCursor)),
    );
    expect(second.recordCount).toBe(1);
    expect(second).not.toHaveProperty('nextCursor');
    expect(second.data).toMatchObject({
      reminderOccurrences: [finalRecord.data],
      reminderOutcomes: [],
      inboxMessages: [],
    });

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.values).toEqual([
      WORKSPACE_ID,
      null,
      null,
      null,
      1_001,
    ]);
    expect(client.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      EVIDENCE_TIME,
      'reminder_occurrence',
      '11111111-1111-4111-8111-0000000003e7',
      1_001,
    ]);
    expect(client.calls[0]?.text).toContain('LIMIT $5');
    expect(client.calls[0]?.text).not.toContain('claim_key_hash');
    expect(client.calls[0]?.text).not.toContain('idempotency_key_hash');
  });

  it('rejects malformed opaque cursors before persistence access', async () => {
    const client = new ScriptedClient([]);
    const contributor = new NotificationDataRightsContributor(client);

    await expect(
      contributor.handle(exportRequest('not/a/base64url/cursor')),
    ).rejects.toThrow('Notification data-rights operation failed');
    expect(client.calls).toEqual([]);
  });
});
