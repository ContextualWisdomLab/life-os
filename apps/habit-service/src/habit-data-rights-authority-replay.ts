import type { HabitSqlClient } from './postgres-habit-repository';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** One credential-free digest identifying a single destructive signed authority. */
export interface HabitDataRightsAuthorityReplayEvidence {
  readonly evidenceDigest: string;
  readonly expiresAt: string;
}

/** Habit-owned persistence authority that atomically consumes destructive request evidence once. */
export interface HabitDataRightsAuthorityReplayGuardPort {
  /** Returns true only for the first still-live durable consumption of this evidence digest. */
  consume(evidence: HabitDataRightsAuthorityReplayEvidence): Promise<boolean>;
}

interface ReplayEvidenceRow {
  readonly evidence_digest: unknown;
}

/** Bounded failure for malformed replay evidence or ambiguous persistence results. */
export class HabitDataRightsAuthorityReplayError extends Error {
  /** Creates a credential-free replay-store failure. */
  constructor() {
    super('Habit data-rights replay evidence is invalid');
    this.name = 'HabitDataRightsAuthorityReplayError';
  }
}

/** Rejects malformed replay evidence without reflecting caller-controlled values. */
function invalid(): never {
  throw new HabitDataRightsAuthorityReplayError();
}

/** Requires one lowercase SHA-256 digest so raw short-lived signatures never enter persistence. */
function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

/** Requires a canonical UTC millisecond instant for the replay-retention deadline. */
function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return invalid();
  }
  return value;
}

/**
 * PostgreSQL compare-and-set guard for destructive Habit data-rights authority.
 *
 * The table primary key makes the first still-live evidence digest the sole winner
 * across service replicas. Raw signatures are never stored. PostgreSQL `now()` is
 * authoritative for both pruning and the insertion lifetime check, preventing an
 * application-clock lag from deleting and re-accepting an already expired proof.
 */
export class PostgresHabitDataRightsAuthorityReplayGuard
  implements HabitDataRightsAuthorityReplayGuardPort
{
  /** Creates the guard over the Habit service's bounded parameterized SQL client. */
  constructor(private readonly client: HabitSqlClient) {}

  /** Atomically consumes one validated digest, returning false for replay or expiry. */
  async consume(
    evidence: HabitDataRightsAuthorityReplayEvidence,
  ): Promise<boolean> {
    const evidenceDigest = requireDigest(evidence.evidenceDigest);
    const expiresAt = requireInstant(evidence.expiresAt);

    await this.client.query(
      `DELETE FROM habit.data_rights_authority_replay_records
       WHERE expires_at < now()`,
      [],
    );
    const inserted = await this.client.query<ReplayEvidenceRow>(
      `INSERT INTO habit.data_rights_authority_replay_records (
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
      return invalid();
    }
    return true;
  }
}
