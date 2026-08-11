const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** One verified one-time operator evidence identity and its bounded lifetime. */
export interface PluginOperatorReplayEvidence {
  readonly evidenceId: string;
  readonly consumedAt: string;
  readonly expiresAt: string;
}

/** Service-owned authority that atomically consumes signed operator evidence once. */
export interface PluginOperatorReplayGuardPort {
  /** Returns true only for the first durable consumption of this evidence identifier. */
  consume(evidence: PluginOperatorReplayEvidence): Promise<boolean>;
}

/** Result returned by the bounded replay-evidence SQL client. */
export interface PluginOperatorReplaySqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL authority used by the PostgreSQL replay guard. */
export interface PluginOperatorReplaySqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginOperatorReplaySqlResult<Row>>;
}

/** Rejects malformed replay evidence before it can become persistence authority. */
export class PluginOperatorReplayValidationError extends Error {
  /** Creates a fixed failure without reflecting invalid caller evidence. */
  constructor() {
    super('Plugin operator replay evidence is invalid');
    this.name = 'PluginOperatorReplayValidationError';
  }
}

interface ReplayEvidenceRow {
  evidence_id: unknown;
}

/** Fails closed for malformed replay evidence without reflecting the value. */
function invalid(): never {
  throw new PluginOperatorReplayValidationError();
}

/** Requires a canonical UUIDv4 evidence identity. */
function evidenceId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

/** Requires a canonical UTC millisecond instant. */
function instant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return invalid();
  }
  return value;
}

/** Validates one replay record and preserves its immutable time ordering. */
function replayEvidence(
  value: PluginOperatorReplayEvidence,
): PluginOperatorReplayEvidence {
  const consumedAt = instant(value.consumedAt);
  const expiresAt = instant(value.expiresAt);
  if (new Date(expiresAt).getTime() < new Date(consumedAt).getTime()) {
    return invalid();
  }
  return Object.freeze({
    evidenceId: evidenceId(value.evidenceId),
    consumedAt,
    expiresAt,
  });
}

/**
 * PostgreSQL implementation of the one-time operator evidence guard.
 *
 * A primary-key insert is the distributed compare-and-set boundary: exactly one
 * service instance can consume a signed evidence UUID. Expired rows are pruned
 * against the database clock, while still-valid rows remain durable across
 * processes so horizontal replicas cannot replay the same authority independently.
 */
export class PostgresPluginOperatorReplayGuard
  implements PluginOperatorReplayGuardPort
{
  /** Creates the guard over a bounded parameterized SQL client. */
  constructor(private readonly client: PluginOperatorReplaySqlClient) {}

  /** Atomically consumes one evidence UUID and returns false for an existing winner. */
  async consume(evidence: PluginOperatorReplayEvidence): Promise<boolean> {
    const safe = replayEvidence(evidence);
    await this.client.query(
      `DELETE FROM plugin_integration.plugin_operator_context_replay_record
       WHERE expires_at < now()`,
    );
    const inserted = await this.client.query<ReplayEvidenceRow>(
      `INSERT INTO plugin_integration.plugin_operator_context_replay_record (
         evidence_id, consumed_at, expires_at
       ) VALUES ($1::uuid, $2::timestamptz, $3::timestamptz)
       ON CONFLICT (evidence_id) DO NOTHING
       RETURNING evidence_id`,
      [safe.evidenceId, safe.consumedAt, safe.expiresAt],
    );
    if (inserted.rows.length > 1 || inserted.rowCount === null) {
      return invalid();
    }
    if (inserted.rows.length === 0) {
      if (inserted.rowCount !== 0) {
        return invalid();
      }
      return false;
    }
    if (
      inserted.rowCount !== 1 ||
      evidenceId(inserted.rows[0]?.evidence_id) !== safe.evidenceId
    ) {
      return invalid();
    }
    return true;
  }
}
