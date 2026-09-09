import { describe, expect, it } from 'vitest';
import type { PluginDeliveryAttemptExecutionFenceCommand } from './plugin-delivery-attempt-execution-fence';
import {
  PluginDeliveryAttemptExecutionFencePersistenceEvidenceError,
  PluginDeliveryAttemptExecutionFencePersistenceValidationError,
  PostgresPluginDeliveryAttemptExecutionFenceStore,
  type PluginDeliveryAttemptExecutionFenceSqlClient,
  type PluginDeliveryAttemptExecutionFenceSqlResult,
} from './plugin-delivery-attempt-execution-fence-repository';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN_DIGEST = 'a'.repeat(64);
const CHECKED_AT = '2026-09-09T02:00:00.000Z';
const CLAIM_EXPIRES_AT = '2026-09-09T02:05:00.000Z';

function command(): PluginDeliveryAttemptExecutionFenceCommand {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    claimTokenDigest: CLAIM_TOKEN_DIGEST,
    checkedAt: CHECKED_AT,
  };
}

function row() {
  return {
    authority_version: 'life-os.plugin-delivery-attempt-execution-fence.v1',
    delivery_id: DELIVERY_ID,
    grant_id: GRANT_ID,
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    attempt_count: 1,
    checked_at: new Date(CHECKED_AT),
    claim_expires_at: new Date(CLAIM_EXPIRES_AT),
  };
}

function harness(result: unknown | Error) {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> =
    [];
  const client: PluginDeliveryAttemptExecutionFenceSqlClient = {
    async query<Row>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (result instanceof Error) {
        throw result;
      }
      return result as PluginDeliveryAttemptExecutionFenceSqlResult<Row>;
    },
  };
  return {
    store: new PostgresPluginDeliveryAttemptExecutionFenceStore(client),
    calls,
  };
}

function oneRow(value: unknown) {
  return { rows: [value], rowCount: 1 };
}

describe('PostgresPluginDeliveryAttemptExecutionFenceStore', () => {
  it('returns exact bounded fence evidence and binds every scoped query parameter', async () => {
    const { store, calls } = harness(oneRow(row()));

    await expect(store.check(command())).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt-execution-fence.v1',
      deliveryId: DELIVERY_ID,
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      attemptNumber: 1,
      checkedAt: CHECKED_AT,
      claimExpiresAt: CLAIM_EXPIRES_AT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('LIMIT 2');
    expect(calls[0]?.values).toEqual([
      DELIVERY_ID,
      WORKSPACE_ID,
      USER_ID,
      CLAIM_TOKEN_DIGEST,
      CHECKED_AT,
    ]);
  });

  it('returns undefined only for an unambiguous empty durable result', async () => {
    const { store } = harness({ rows: [], rowCount: 0 });
    await expect(store.check(command())).resolves.toBeUndefined();
  });

  it('rejects malformed command values before exercising SQL authority', async () => {
    const revoked = Proxy.revocable(command(), {});
    revoked.revoke();
    const throwing = {
      ...command(),
      get deliveryId(): string {
        throw new Error('request-secret');
      },
    };
    const invalidCommands: unknown[] = [
      null,
      [],
      revoked.proxy,
      throwing,
      { ...command(), deliveryId: 7 },
      { ...command(), deliveryId: 'not-a-uuid' },
      { ...command(), workspaceId: 'not-a-uuid' },
      { ...command(), requestedByUserId: 'not-a-uuid' },
      { ...command(), claimTokenDigest: 7 },
      { ...command(), claimTokenDigest: 'not-a-digest' },
      { ...command(), checkedAt: 7 },
      { ...command(), checkedAt: 'not-an-instant' },
      { ...command(), checkedAt: '2026-02-30T02:00:00.000Z' },
    ];

    for (const invalid of invalidCommands) {
      const { store, calls } = harness(oneRow(row()));
      await expect(
        store.check(invalid as PluginDeliveryAttemptExecutionFenceCommand),
      ).rejects.toEqual(
        new PluginDeliveryAttemptExecutionFencePersistenceValidationError(),
      );
      expect(calls).toEqual([]);
    }
  });

  it('collapses SQL dependency rejection without reflecting backend detail', async () => {
    const { store } = harness(new Error('database-host=private.internal'));
    await expect(store.check(command())).rejects.toEqual(
      new PluginDeliveryAttemptExecutionFencePersistenceEvidenceError(),
    );
  });

  it('rejects malformed SQL result envelopes instead of accepting ambiguous evidence', async () => {
    const revokedRows = Proxy.revocable([row()], {});
    revokedRows.revoke();
    const revokedResult = Proxy.revocable(oneRow(row()), {});
    revokedResult.revoke();
    const malformedResults: unknown[] = [
      null,
      [],
      revokedResult.proxy,
      { rows: null, rowCount: 0 },
      { rows: revokedRows.proxy, rowCount: 1 },
      { rows: [], rowCount: null },
      { rows: [], rowCount: 0.5 },
      { rows: [], rowCount: -1 },
      { rows: [], rowCount: 1 },
      { rows: [row(), row()], rowCount: 2 },
      { rows: [undefined], rowCount: 1 },
    ];

    for (const malformed of malformedResults) {
      const { store } = harness(malformed);
      await expect(store.check(command())).rejects.toEqual(
        new PluginDeliveryAttemptExecutionFencePersistenceEvidenceError(),
      );
    }
  });

  it('rejects corrupt durable fence rows across identity, chronology and attempt bounds', async () => {
    const revokedRow = Proxy.revocable(row(), {});
    revokedRow.revoke();
    const invalidRows: unknown[] = [
      null,
      [],
      revokedRow.proxy,
      { ...row(), authority_version: 'unexpected' },
      { ...row(), delivery_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { ...row(), workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      {
        ...row(),
        requested_by_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      { ...row(), attempt_count: '1' },
      { ...row(), attempt_count: 0 },
      { ...row(), attempt_count: 11 },
      { ...row(), checked_at: new Date('invalid') },
      { ...row(), checked_at: 'not-an-instant' },
      { ...row(), checked_at: '2026-09-09T01:59:59.000Z' },
      { ...row(), claim_expires_at: 'not-an-instant' },
      { ...row(), claim_expires_at: CHECKED_AT },
      { ...row(), grant_id: 'not-a-uuid' },
      { ...row(), installation_id: 'not-a-uuid' },
    ];

    for (const invalid of invalidRows) {
      const { store } = harness(oneRow(invalid));
      await expect(store.check(command())).rejects.toEqual(
        new PluginDeliveryAttemptExecutionFencePersistenceEvidenceError(),
      );
    }
  });
});
