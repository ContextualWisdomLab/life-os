import type { NotificationSqlClient } from './postgres-reminder-repository';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Credential-free evidence identifying one short-lived destructive service authority. */
export interface NotificationDataRightsAuthorityReplayEvidence {
  readonly evidenceDigest: string;
  readonly expiresAt: string;
}

/** Notification-owned persistence boundary that claims destructive authority until success or explicit failure release. */
export interface NotificationDataRightsAuthorityReplayGuardPort {
  /** Returns true only for the first still-live durable claim of the evidence digest. */
  consume(
    evidence: NotificationDataRightsAuthorityReplayEvidence,
  ): Promise<boolean>;
  /** Releases only the exact credential-free digest after a failed destructive execution so an authorized retry can reclaim it. */
  release(evidenceDigest: string): Promise<void>;
}

interface ReplayEvidenceRow {
  readonly evidence_digest: unknown;
}

/** Bounded failure for malformed replay evidence or ambiguous persistence results. */
export class NotificationDataRightsAuthorityReplayError extends Error {
  /** Creates one credential-free replay-store failure. */
  constructor() {
    super('Notification data-rights replay evidence is invalid');
    this.name = 'NotificationDataRightsAuthorityReplayError';
  }
}

/** Rejects malformed replay evidence without reflecting caller-controlled data. */
function invalidReplayEvidence(): never {
  throw new NotificationDataRightsAuthorityReplayError();
}

/** Requires one lowercase SHA-256 digest so raw HMAC signatures never enter persistence. */
function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
    return invalidReplayEvidence();
  }
  return value;
}

/** Requires a real canonical UTC millisecond instant for the replay-retention deadline. */
function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalidReplayEvidence();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return invalidReplayEvidence();
  }
  return value;
}

/**
 * PostgreSQL compare-and-set guard for destructive Notification data-rights authority.
 *
 * The primary key makes the first still-live signature digest the sole winner
 * across service replicas. Raw signatures are never persisted. PostgreSQL
 * `now()` governs pruning and expiry. A controller releases the exact digest
 * only when the protected erasure operation fails before returning a receipt;
 * successful authority remains consumed for its lifetime.
 */
export class PostgresNotificationDataRightsAuthorityReplayGuard
  implements NotificationDataRightsAuthorityReplayGuardPort
{
  /** Creates the guard over the Notification service's parameterized SQL boundary. */
  constructor(private readonly client: NotificationSqlClient) {}

  /** Atomically claims one validated digest, returning false for replay or expiry. */
  async consume(
    evidence: NotificationDataRightsAuthorityReplayEvidence,
  ): Promise<boolean> {
    const evidenceDigest = requireDigest(evidence.evidenceDigest);
    const expiresAt = requireInstant(evidence.expiresAt);

    await this.client.query(
      `DELETE FROM notification_service.data_rights_authority_replay_records
       WHERE expires_at < now()`,
      [],
    );
    const inserted = await this.client.query<ReplayEvidenceRow>(
      `INSERT INTO notification_service.data_rights_authority_replay_records (
         evidence_digest, expires_at
       )
       SELECT $1, $2::timestamptz
       WHERE $2::timestamptz >= now()
       ON CONFLICT (evidence_digest) DO NOTHING
       RETURNING evidence_digest`,
      [evidenceDigest, expiresAt],
    );

    if (inserted.rows.length === 0) {
      return false;
    }
    if (
      inserted.rows.length !== 1 ||
      requireDigest(inserted.rows[0]?.evidence_digest) !== evidenceDigest
    ) {
      return invalidReplayEvidence();
    }
    return true;
  }

  /** Releases a previously claimed digest after a failed erasure without widening authority or retaining raw credentials. */
  async release(evidenceDigestInput: string): Promise<void> {
    const evidenceDigest = requireDigest(evidenceDigestInput);
    await this.client.query(
      `DELETE FROM notification_service.data_rights_authority_replay_records
       WHERE evidence_digest = $1`,
      [evidenceDigest],
    );
  }
}
