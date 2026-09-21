import { describe, expect, it } from 'vitest';
import {
  PostgresNotificationDataRightsAuthorityReplayGuard,
  type NotificationDataRightsAuthorityReplayEvidence,
} from './notification-data-rights-authority-replay';
import type {
  NotificationSqlClient,
  NotificationSqlQueryResult,
} from './postgres-reminder-repository';

const DIGEST = 'a'.repeat(64);
const EXPIRES_AT = '2026-08-12T00:01:00.000Z';

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
    const result = this.script.shift();
    if (result === undefined) {
      throw new Error('test script exhausted');
    }
    return result as NotificationSqlQueryResult<Row>;
  }
}

const EVIDENCE: NotificationDataRightsAuthorityReplayEvidence = Object.freeze({
  evidenceDigest: DIGEST,
  expiresAt: EXPIRES_AT,
});

describe('PostgresNotificationDataRightsAuthorityReplayGuard', () => {
  it('atomically accepts only the first still-live destructive authority digest', async () => {
    const client = new ScriptedClient([
      { rows: [] },
      { rows: [{ evidence_digest: DIGEST }] },
      { rows: [] },
      { rows: [] },
    ]);
    const guard = new PostgresNotificationDataRightsAuthorityReplayGuard(client);

    await expect(guard.consume(EVIDENCE)).resolves.toBe(true);
    await expect(guard.consume(EVIDENCE)).resolves.toBe(false);

    expect(client.calls).toHaveLength(4);
    expect(client.calls[0]?.text).toContain(
      'DELETE FROM notification_service.data_rights_authority_replay_records',
    );
    expect(client.calls[1]?.text).toContain('ON CONFLICT (evidence_digest) DO NOTHING');
    expect(client.calls[1]?.values).toEqual([DIGEST, EXPIRES_AT]);
    expect(client.calls[3]?.values).toEqual([DIGEST, EXPIRES_AT]);
  });

  it.each<NotificationDataRightsAuthorityReplayEvidence>([
    { evidenceDigest: 'not-a-digest', expiresAt: EXPIRES_AT },
    { evidenceDigest: DIGEST, expiresAt: '2026-02-30T00:00:00.000Z' },
    { evidenceDigest: DIGEST, expiresAt: '2026-08-12T00:01:00Z' },
  ])('rejects malformed replay evidence before persistence', async (evidence) => {
    const client = new ScriptedClient([]);
    const guard = new PostgresNotificationDataRightsAuthorityReplayGuard(client);

    await expect(guard.consume(evidence)).rejects.toThrow(
      'Notification data-rights replay evidence is invalid',
    );
    expect(client.calls).toEqual([]);
  });

  it('fails closed on ambiguous persistence evidence', async () => {
    const client = new ScriptedClient([
      { rows: [] },
      {
        rows: [
          { evidence_digest: DIGEST },
          { evidence_digest: DIGEST },
        ],
      },
    ]);
    const guard = new PostgresNotificationDataRightsAuthorityReplayGuard(client);

    await expect(guard.consume(EVIDENCE)).rejects.toThrow(
      'Notification data-rights replay evidence is invalid',
    );
  });
});
