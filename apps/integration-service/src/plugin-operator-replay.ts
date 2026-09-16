const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

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

interface ReplayConsumeRow {
  consumed: unknown;
}

/** Fails closed for malformed replay evidence without reflecting the value. */
function invalid(): never {
  throw new PluginOperatorReplayValidationError();
}

/** Collapses hostile caller or SQL evidence access to the fixed credential-free error. */
function boundedReplayEvidenceRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalid();
  }
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
  const rawEvidenceId = boundedReplayEvidenceRead(() => value.evidenceId);
  const rawConsumedAt = boundedReplayEvidenceRead(() => value.consumedAt);
  const rawExpiresAt = boundedReplayEvidenceRead(() => value.expiresAt);
  const consumedAt = instant(rawConsumedAt);
  const expiresAt = instant(rawExpiresAt);
  if (new Date(expiresAt).getTime() < new Date(consumedAt).getTime()) {
    return invalid();
  }
  return Object.freeze({
    evidenceId: evidenceId(rawEvidenceId),
    consumedAt,
    expiresAt,
  });
}

/**
 * PostgreSQL implementation of the one-time operator evidence guard.
 *
 * The Integration-owned consume function is the distributed compare-and-set boundary:
 * exactly one service instance can consume a still-valid signed evidence UUID. It performs
 * a conflict-safe insert/expired replacement first, then bounded expiry cleanup with
 * `SKIP LOCKED`, so cleanup cannot turn concurrent current evidence into a lock cycle.
 * Keeping consume and cleanup inside one PostgreSQL invocation removes an otherwise
 * unconditional network round trip from every authenticated operator request while the
 * expiry index continues to bound cleanup work.
 */
export class PostgresPluginOperatorReplayGuard implements PluginOperatorReplayGuardPort {
  /** Creates the guard over a bounded parameterized SQL client. */
  constructor(private readonly client: PluginOperatorReplaySqlClient) {}

  /** Atomically consumes one evidence UUID and returns false for an existing winner. */
  async consume(evidence: PluginOperatorReplayEvidence): Promise<boolean> {
    const safe = replayEvidence(evidence);
    const result = await this.client.query<ReplayConsumeRow>(
      `SELECT plugin_integration.consume_plugin_operator_context_replay(
         $1::uuid, $2::timestamptz, $3::timestamptz
       ) AS consumed`,
      [safe.evidenceId, safe.consumedAt, safe.expiresAt],
    );
    const rows = boundedReplayEvidenceRead(() => result.rows);
    const rowCount = boundedReplayEvidenceRead(() => result.rowCount);
    const rowsAreArray = boundedReplayEvidenceRead(() => Array.isArray(rows));
    if (!rowsAreArray) {
      return invalid();
    }
    const rowsLength = boundedReplayEvidenceRead(() => rows.length);
    if (rowCount !== 1 || rowsLength !== 1) {
      return invalid();
    }
    const row = boundedReplayEvidenceRead(() => rows[0]);
    const consumed = boundedReplayEvidenceRead(() => row?.consumed);
    if (typeof consumed !== 'boolean') {
      return invalid();
    }
    return consumed;
  }
}
