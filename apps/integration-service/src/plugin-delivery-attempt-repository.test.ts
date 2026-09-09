import { describe, expect, it } from 'vitest';
import type { PluginDeliveryAttemptRecord } from './plugin-delivery-attempt';
import {
  PluginDeliveryAttemptPersistenceEvidenceError,
  PluginDeliveryAttemptPersistenceValidationError,
  PostgresPluginDeliveryAttemptStore,
  type PluginDeliveryAttemptSqlClient,
  type PluginDeliveryAttemptSqlResult,
} from './plugin-delivery-attempt-repository';

const RECORD: PluginDeliveryAttemptRecord = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-attempt.v1',
  deliveryId: '55555555-5555-4555-8555-555555555555',
  grantId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  requestedByUserId: '44444444-4444-4444-8444-444444444444',
  status: 'pending',
  attemptCount: 0,
  maxAttempts: 4,
  requestedAt: '2026-09-08T04:40:00.000Z',
  updatedAt: '2026-09-08T04:41:00.000Z',
  nextAttemptAt: '2026-09-08T04:45:00.000Z',
  terminalAt: null,
  lastOutcomeCode: null,
});

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class ScriptedSqlClient implements PluginDeliveryAttemptSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly results: PluginDeliveryAttemptSqlResult<
      Record<string, unknown>
    >[],
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginDeliveryAttemptSqlResult<Row>> {
    this.calls.push({ text, values });
    const next = this.results.shift();
    if (!next) {
      throw new Error('Unexpected SQL call');
    }
    return next as PluginDeliveryAttemptSqlResult<Row>;
  }
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authority_version: RECORD.authorityVersion,
    delivery_id: RECORD.deliveryId,
    grant_id: RECORD.grantId,
    installation_id: RECORD.installationId,
    workspace_id: RECORD.workspaceId,
    requested_by_user_id: RECORD.requestedByUserId,
    delivery_status: RECORD.status,
    attempt_count: RECORD.attemptCount,
    max_attempts: RECORD.maxAttempts,
    requested_at: new Date(RECORD.requestedAt),
    updated_at: new Date(RECORD.updatedAt),
    next_attempt_at: new Date(RECORD.nextAttemptAt),
    terminal_at: RECORD.terminalAt,
    last_outcome_code: RECORD.lastOutcomeCode,
    ...overrides,
  };
}

function result(
  rows: readonly Record<string, unknown>[],
): PluginDeliveryAttemptSqlResult<Record<string, unknown>> {
  return { rows, rowCount: rows.length };
}

function storeForUnknownResults(
  ...results: readonly unknown[]
): PostgresPluginDeliveryAttemptStore {
  let index = 0;
  const client: PluginDeliveryAttemptSqlClient = {
    async query<Row>(): Promise<PluginDeliveryAttemptSqlResult<Row>> {
      if (index >= results.length) {
        throw new Error('Unexpected SQL call');
      }
      const next = results[index];
      index += 1;
      if (next instanceof Error) {
        throw next;
      }
      return next as PluginDeliveryAttemptSqlResult<Row>;
    },
  };
  return new PostgresPluginDeliveryAttemptStore(client);
}

function invalidRecord(
  overrides: Record<string, unknown>,
): PluginDeliveryAttemptRecord {
  return { ...RECORD, ...overrides } as PluginDeliveryAttemptRecord;
}

describe('PostgresPluginDeliveryAttemptStore', () => {
  it('uses one parameterized idempotent admission statement and returns exact durable scope', async () => {
    const client = new ScriptedSqlClient([result([row()])]);
    const store = new PostgresPluginDeliveryAttemptStore(client);

    await expect(store.createIfAbsent(RECORD)).resolves.toEqual(RECORD);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'plugin_integration.plugin_delivery_attempt_record',
    );
    expect(client.calls[0]?.text).toContain(
      'ON CONFLICT (delivery_id) DO NOTHING',
    );
    expect(client.calls[0]?.text).toContain(
      '$8::timestamptz, $9::timestamptz,\n         $10::timestamptz',
    );
    expect(client.calls[0]?.text).not.toContain(RECORD.deliveryId);
    expect(client.calls[0]?.values).toEqual([
      RECORD.authorityVersion,
      RECORD.deliveryId,
      RECORD.grantId,
      RECORD.installationId,
      RECORD.workspaceId,
      RECORD.requestedByUserId,
      RECORD.maxAttempts,
      RECORD.requestedAt,
      RECORD.updatedAt,
      RECORD.nextAttemptAt,
    ]);
  });

  it('canonicalizes uppercase UUIDv4 request identities before persistence', async () => {
    const client = new ScriptedSqlClient([result([row()])]);
    const store = new PostgresPluginDeliveryAttemptStore(client);
    const uppercase = {
      ...RECORD,
      deliveryId: RECORD.deliveryId.toUpperCase(),
      grantId: RECORD.grantId.toUpperCase(),
      installationId: RECORD.installationId.toUpperCase(),
      workspaceId: RECORD.workspaceId.toUpperCase(),
      requestedByUserId: RECORD.requestedByUserId.toUpperCase(),
    };

    await expect(store.createIfAbsent(uppercase)).resolves.toEqual(RECORD);
    expect(client.calls[0]?.values?.slice(1, 6)).toEqual([
      RECORD.deliveryId,
      RECORD.grantId,
      RECORD.installationId,
      RECORD.workspaceId,
      RECORD.requestedByUserId,
    ]);
  });

  it('re-reads the exact durable winner with a fresh statement after a conflict snapshot returns no row', async () => {
    const client = new ScriptedSqlClient([result([]), result([row()])]);
    const store = new PostgresPluginDeliveryAttemptStore(client);

    await expect(store.createIfAbsent(RECORD)).resolves.toEqual(RECORD);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.text).toContain(
      'ON CONFLICT (delivery_id) DO NOTHING',
    );
    expect(client.calls[1]?.text).toContain('WHERE delivery_id = $1::uuid');
    expect(client.calls[1]?.text).toContain('grant_id = $2::uuid');
    expect(client.calls[1]?.text).toContain('installation_id = $3::uuid');
    expect(client.calls[1]?.text).toContain('workspace_id = $4::uuid');
    expect(client.calls[1]?.text).toContain('requested_by_user_id = $5::uuid');
    expect(client.calls[1]?.values).toEqual([
      RECORD.deliveryId,
      RECORD.grantId,
      RECORD.installationId,
      RECORD.workspaceId,
      RECORD.requestedByUserId,
      RECORD.maxAttempts,
    ]);
  });

  it('rejects hostile command reads and malformed admission invariants before issuing SQL', async () => {
    const revoked = Proxy.revocable(RECORD, {});
    revoked.revoke();
    const hostile = new Proxy(RECORD, {
      get(target, property, receiver) {
        if (property === 'deliveryId') {
          throw new Error('password=must-not-escape-attempt-input');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const invalidRecords: readonly unknown[] = [
      null,
      [],
      revoked.proxy,
      hostile,
      invalidRecord({ authorityVersion: 'life-os.plugin-delivery-attempt.v2' }),
      invalidRecord({ status: 'failed' }),
      invalidRecord({ attemptCount: 1 }),
      invalidRecord({ terminalAt: RECORD.updatedAt }),
      invalidRecord({ lastOutcomeCode: 'retryable_failure' }),
      invalidRecord({ requestedAt: 123 }),
      invalidRecord({ requestedAt: 'not-an-instant' }),
      invalidRecord({ requestedAt: '2026-02-31T04:40:00.000Z' }),
      invalidRecord({ updatedAt: 'not-an-instant' }),
      invalidRecord({ updatedAt: '2026-02-31T04:41:00.000Z' }),
      invalidRecord({ nextAttemptAt: 'not-an-instant' }),
      invalidRecord({ nextAttemptAt: '2026-02-31T04:45:00.000Z' }),
      invalidRecord({ updatedAt: '2026-09-08T04:39:59.999Z' }),
      invalidRecord({ nextAttemptAt: '2026-09-08T04:39:59.999Z' }),
      invalidRecord({ deliveryId: 123 }),
      invalidRecord({ deliveryId: 'not-a-uuid' }),
      invalidRecord({ grantId: 'not-a-uuid' }),
      invalidRecord({ installationId: 'not-a-uuid' }),
      invalidRecord({ workspaceId: 'not-a-uuid' }),
      invalidRecord({ requestedByUserId: 'not-a-uuid' }),
      invalidRecord({ maxAttempts: '4' }),
      invalidRecord({ maxAttempts: 1.5 }),
      invalidRecord({ maxAttempts: 0 }),
      invalidRecord({ maxAttempts: 11 }),
    ];

    for (const candidate of invalidRecords) {
      const client = new ScriptedSqlClient([]);
      const store = new PostgresPluginDeliveryAttemptStore(client);
      await expect(
        store.createIfAbsent(candidate as PluginDeliveryAttemptRecord),
      ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceValidationError);
      expect(client.calls).toHaveLength(0);
    }
  });

  it('collapses initial and replay SQL rejection without reflecting dependency detail', async () => {
    const sensitive = new Error('password=must-not-escape-attempt-sql');
    await expect(
      storeForUnknownResults(sensitive).createIfAbsent(RECORD),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'PluginDeliveryAttemptPersistenceEvidenceError',
        message: 'Persisted plugin delivery attempt evidence is invalid',
      }),
    );
    await expect(
      storeForUnknownResults(result([]), sensitive).createIfAbsent(RECORD),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceEvidenceError);
  });

  it('collapses hostile SQL result and row getters into fixed persistence evidence errors', async () => {
    const sensitiveNativeDetail = 'provider-secret=must-not-escape';
    const hostileResult = new Proxy(
      {} as PluginDeliveryAttemptSqlResult<Record<string, unknown>>,
      {
        get: (_target, property) => {
          if (property === 'rows') {
            throw new Error(sensitiveNativeDetail);
          }
          if (property === 'rowCount') {
            return 1;
          }
          return undefined;
        },
      },
    );
    const hostileRow = new Proxy(row(), {
      get: (target, property, receiver) => {
        if (property === 'authority_version') {
          throw new Error(sensitiveNativeDetail);
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const revokedResult = Proxy.revocable({ rows: [row()], rowCount: 1 }, {});
    revokedResult.revoke();
    const revokedRow = Proxy.revocable(row(), {});
    revokedRow.revoke();

    for (const durableResult of [
      hostileResult,
      revokedResult.proxy,
      result([hostileRow]),
      { rows: [revokedRow.proxy], rowCount: 1 },
    ]) {
      await expect(
        storeForUnknownResults(durableResult).createIfAbsent(RECORD),
      ).rejects.toEqual(
        expect.objectContaining({
          name: 'PluginDeliveryAttemptPersistenceEvidenceError',
          message: 'Persisted plugin delivery attempt evidence is invalid',
        }),
      );
    }
  });

  it('fails closed on malformed SQL envelopes, row counts, and hostile row arrays', async () => {
    const lengthRows = new Proxy([row()], {
      get(target, property, receiver) {
        if (property === 'length') {
          throw new Error('secret=row-length');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const elementRows = new Proxy([row()], {
      get(target, property, receiver) {
        if (property === '0') {
          throw new Error('secret=row-element');
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const revokedRows = Proxy.revocable([row()], {});
    revokedRows.revoke();
    const malformed: readonly unknown[] = [
      null,
      'not-a-result',
      [],
      { rows: 'not-an-array', rowCount: 0 },
      { rows: revokedRows.proxy, rowCount: 1 },
      { rows: [], rowCount: null },
      { rows: [], rowCount: 0.5 },
      { rows: [], rowCount: -1 },
      { rows: [], rowCount: 1 },
      { rows: [row(), row()], rowCount: 2 },
      { rows: [undefined], rowCount: 1 },
      { rows: lengthRows, rowCount: 1 },
      { rows: elementRows, rowCount: 1 },
    ];

    for (const durableResult of malformed) {
      await expect(
        storeForUnknownResults(durableResult).createIfAbsent(RECORD),
      ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceEvidenceError);
    }
  });

  it('fails closed on malformed durable row lifecycle, identities, counters, and chronology', async () => {
    const malformedRows: readonly unknown[] = [
      null,
      'not-a-row',
      [],
      row({ authority_version: 'life-os.plugin-delivery-attempt.v2' }),
      row({ delivery_status: 'paused' }),
      row({ attempt_count: 1 }),
      row({ terminal_at: RECORD.updatedAt }),
      row({ last_outcome_code: 'retryable_failure' }),
      row({ delivery_id: 123 }),
      row({ delivery_id: 'not-a-uuid' }),
      row({ delivery_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }),
      row({ grant_id: 'not-a-uuid' }),
      row({ installation_id: 'not-a-uuid' }),
      row({ workspace_id: 'not-a-uuid' }),
      row({ requested_by_user_id: 'not-a-uuid' }),
      row({ max_attempts: '4' }),
      row({ max_attempts: 1.5 }),
      row({ max_attempts: 0 }),
      row({ max_attempts: 11 }),
      row({ requested_at: new Date(Number.NaN) }),
      row({ requested_at: 'not-an-instant' }),
      row({ requested_at: '2026-02-31T04:40:00.000Z' }),
      row({ updated_at: new Date(Number.NaN) }),
      row({ updated_at: 'not-an-instant' }),
      row({ updated_at: '2026-02-31T04:41:00.000Z' }),
      row({ next_attempt_at: new Date(Number.NaN) }),
      row({ next_attempt_at: 'not-an-instant' }),
      row({ next_attempt_at: '2026-02-31T04:45:00.000Z' }),
      row({ updated_at: new Date('2026-09-08T04:39:59.999Z') }),
      row({ next_attempt_at: new Date('2026-09-08T04:39:59.999Z') }),
    ];

    for (const malformedRow of malformedRows) {
      await expect(
        storeForUnknownResults({ rows: [malformedRow], rowCount: 1 }).createIfAbsent(
          RECORD,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceEvidenceError);
    }
  });

  it('fails closed when an idempotency winner is absent, ambiguous, foreign, or newer than the request', async () => {
    const foreignWinnerRows = [
      row({ delivery_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ grant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ installation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ requested_by_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ max_attempts: 5 }),
      row({ requested_at: new Date('2026-09-08T04:40:00.001Z') }),
    ];

    await expect(
      storeForUnknownResults(result([]), result([])).createIfAbsent(RECORD),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceEvidenceError);
    await expect(
      storeForUnknownResults(result([row(), row()])).createIfAbsent(RECORD),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceEvidenceError);

    for (const foreignWinner of foreignWinnerRows) {
      await expect(
        storeForUnknownResults(result([foreignWinner])).createIfAbsent(RECORD),
      ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceEvidenceError);
    }
  });
});
