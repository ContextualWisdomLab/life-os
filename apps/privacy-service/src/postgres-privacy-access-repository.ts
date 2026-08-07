import {
  PRIVACY_ACCESS_ACTIONS,
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  PRIVACY_ACCESS_PURPOSES,
  PRIVACY_RESOURCE_CATEGORIES,
  type PrivacyAccessAction,
  type PrivacyAccessDecision,
  type PrivacyAccessMode,
  type PrivacyAccessPurpose,
  type PrivacyResourceCategory,
} from './privacy-access-domain';
import type {
  PrivacyAccessRepository,
  PrivacyDecisionPersistenceInput,
  PrivacyGrantConsumptionInput,
  PrivacyGrantConsumptionReceipt,
} from './privacy-access-repository';
import { PRIVACY_ACCESS_GRANT_SCHEMA } from './privacy-access-token';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const RFC_3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Minimal query result returned by a PostgreSQL client. */
export interface PrivacySqlQueryResult<Row> {
  readonly rows: readonly Row[];
}

/** Transaction client owned by one checked-out PostgreSQL connection. */
export interface PrivacySqlTransactionClient {
  /** Executes one static parameterized statement. */
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PrivacySqlQueryResult<Row>>;
  /** Returns the checked-out connection to its pool. */
  release(): void;
}

/** Pool boundary required by the privacy repository. */
export interface PrivacySqlPool {
  /** Checks out one transaction-capable connection. */
  connect(): Promise<PrivacySqlTransactionClient>;
}

/** Stable sanitized persistence failure without database or tenant details. */
export class PrivacyAccessPersistenceError extends Error {
  /** Creates one credential-free failure classification. */
  constructor() {
    super('Privacy access persistence operation failed');
    this.name = 'PrivacyAccessPersistenceError';
  }
}

interface ConsumedGrantRow {
  readonly grant_id: unknown;
  readonly decision_id: unknown;
  readonly workspace_id: unknown;
  readonly actor_id: unknown;
  readonly purpose_code: unknown;
  readonly action_code: unknown;
  readonly resource_category: unknown;
  readonly access_mode: unknown;
  readonly policy_revision_id: unknown;
  readonly policy_digest: unknown;
  readonly occurred_at: unknown;
}

const INSERT_DECISION_SQL = `
INSERT INTO privacy_access.privacy_access_decisions (
  decision_id,
  grant_id,
  workspace_id,
  actor_id,
  purpose_code,
  action_code,
  resource_category,
  access_mode,
  decision_outcome,
  policy_revision_id,
  policy_digest,
  request_digest,
  reason_digest,
  issued_at,
  expires_at
) VALUES (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::uuid,
  $5::text,
  $6::text,
  $7::text,
  $8::text,
  $9::text,
  $10::uuid,
  $11::char(64),
  $12::char(64),
  $13::char(64),
  $14::timestamptz,
  $15::timestamptz
)`;

const INSERT_GRANT_SQL = `
INSERT INTO privacy_access.privacy_access_grants (
  grant_id,
  decision_id,
  workspace_id,
  actor_id,
  token_digest,
  policy_revision_id,
  policy_digest,
  issued_at,
  expires_at
) VALUES (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::uuid,
  $5::char(64),
  $6::uuid,
  $7::char(64),
  $8::timestamptz,
  $9::timestamptz
)`;

const CONSUME_GRANT_SQL = `
UPDATE privacy_access.privacy_access_grants AS privacy_grant
SET
  consumed_at = $9::timestamptz,
  consumed_event_id = $8::uuid
FROM privacy_access.privacy_access_decisions AS privacy_decision
WHERE privacy_grant.grant_id = $1::uuid
  AND privacy_grant.decision_id = $2::uuid
  AND privacy_grant.workspace_id = $3::uuid
  AND privacy_grant.actor_id = $4::uuid
  AND privacy_grant.token_digest = $5::char(64)
  AND privacy_grant.policy_revision_id = $6::uuid
  AND privacy_grant.policy_digest = $7::char(64)
  AND privacy_grant.consumed_at IS NULL
  AND privacy_grant.consumed_event_id IS NULL
  AND privacy_grant.issued_at <= $10::timestamptz
  AND privacy_grant.expires_at >= $10::timestamptz
  AND privacy_decision.decision_id = privacy_grant.decision_id
  AND privacy_decision.grant_id = privacy_grant.grant_id
  AND privacy_decision.workspace_id = privacy_grant.workspace_id
  AND privacy_decision.actor_id = privacy_grant.actor_id
  AND privacy_decision.decision_outcome = 'allowed'
RETURNING
  privacy_grant.grant_id,
  privacy_grant.decision_id,
  privacy_grant.workspace_id,
  privacy_grant.actor_id,
  privacy_decision.purpose_code,
  privacy_decision.action_code,
  privacy_decision.resource_category,
  privacy_decision.access_mode,
  privacy_grant.policy_revision_id,
  privacy_grant.policy_digest,
  privacy_grant.consumed_at AS occurred_at`;

const INSERT_EVENT_SQL = `
INSERT INTO privacy_access.privacy_access_events (
  access_event_id,
  grant_id,
  decision_id,
  workspace_id,
  actor_id,
  purpose_code,
  action_code,
  resource_category,
  access_mode,
  policy_revision_id,
  policy_digest,
  resource_reference_digest,
  occurred_at
) VALUES (
  $1::uuid,
  $2::uuid,
  $3::uuid,
  $4::uuid,
  $5::uuid,
  $6::text,
  $7::text,
  $8::text,
  $9::text,
  $10::uuid,
  $11::char(64),
  $12::char(64),
  $13::timestamptz
)`;

function invalid(): never {
  throw new PrivacyAccessPersistenceError();
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : invalid();
}

function requireDigest(value: unknown): string {
  return typeof value === 'string' && SHA_256_PATTERN.test(value)
    ? value
    : invalid();
}

function requireTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? invalid() : value.toISOString();
  }
  if (typeof value !== 'string' || !RFC_3339_PATTERN.test(value)) {
    return invalid();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? value
    : invalid();
}

function requirePurpose(value: unknown): PrivacyAccessPurpose {
  return typeof value === 'string' &&
    (PRIVACY_ACCESS_PURPOSES as readonly string[]).includes(value)
    ? (value as PrivacyAccessPurpose)
    : invalid();
}

function requireAction(value: unknown): PrivacyAccessAction {
  return typeof value === 'string' &&
    (PRIVACY_ACCESS_ACTIONS as readonly string[]).includes(value)
    ? (value as PrivacyAccessAction)
    : invalid();
}

function requireCategory(value: unknown): PrivacyResourceCategory {
  return typeof value === 'string' &&
    (PRIVACY_RESOURCE_CATEGORIES as readonly string[]).includes(value)
    ? (value as PrivacyResourceCategory)
    : invalid();
}

function requireMode(value: unknown): PrivacyAccessMode {
  return value === 'ordinary' || value === 'break_glass' ? value : invalid();
}

function validateDecision(
  input: PrivacyDecisionPersistenceInput,
): PrivacyDecisionPersistenceInput {
  if (!input || typeof input !== 'object') {
    return invalid();
  }
  const decision = input.decision;
  if (!decision || typeof decision !== 'object') {
    return invalid();
  }
  const normalized: PrivacyAccessDecision = {
    decisionId: requireUuid(decision.decisionId),
    workspaceId: requireUuid(decision.workspaceId),
    actorId: requireUuid(decision.actorId),
    purpose: requirePurpose(decision.purpose),
    action: requireAction(decision.action),
    resourceCategory: requireCategory(decision.resourceCategory),
    accessMode: requireMode(decision.accessMode),
    outcome:
      decision.outcome === 'allowed' || decision.outcome === 'denied'
        ? decision.outcome
        : invalid(),
    policyRevisionId: requireUuid(decision.policyRevisionId),
    policyDigest: requireDigest(decision.policyDigest),
    requestDigest: requireDigest(decision.requestDigest),
    reasonDigest: requireDigest(decision.reasonDigest),
    issuedAt: requireTimestamp(decision.issuedAt),
  };
  if (
    normalized.policyRevisionId !== PRIVACY_ACCESS_POLICY_REVISION_ID ||
    normalized.policyDigest !== PRIVACY_ACCESS_POLICY_DIGEST ||
    (normalized.accessMode === 'break_glass') !==
      (normalized.purpose === 'break_glass')
  ) {
    return invalid();
  }
  if (normalized.outcome === 'denied') {
    if (
      decision.grantId !== undefined ||
      decision.expiresAt !== undefined ||
      input.tokenDigest !== undefined
    ) {
      return invalid();
    }
    return Object.freeze({ decision: Object.freeze(normalized) });
  }
  const grantId = requireUuid(decision.grantId);
  const expiresAt = requireTimestamp(decision.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(normalized.issuedAt)) {
    return invalid();
  }
  const tokenDigest = requireDigest(input.tokenDigest);
  return Object.freeze({
    decision: Object.freeze({ ...normalized, grantId, expiresAt }),
    tokenDigest,
  });
}

function validateConsumption(
  input: PrivacyGrantConsumptionInput,
): PrivacyGrantConsumptionInput {
  if (!input || typeof input !== 'object') {
    return invalid();
  }
  const claims = input.claims;
  if (
    !claims ||
    typeof claims !== 'object' ||
    claims.schema !== PRIVACY_ACCESS_GRANT_SCHEMA
  ) {
    return invalid();
  }
  const normalizedClaims = Object.freeze({
    schema: PRIVACY_ACCESS_GRANT_SCHEMA,
    keyId:
      typeof claims.keyId === 'string' && claims.keyId.length > 0
        ? claims.keyId
        : invalid(),
    grantId: requireUuid(claims.grantId),
    decisionId: requireUuid(claims.decisionId),
    workspaceId: requireUuid(claims.workspaceId),
    actorId: requireUuid(claims.actorId),
    purpose: requirePurpose(claims.purpose),
    action: requireAction(claims.action),
    resourceCategory: requireCategory(claims.resourceCategory),
    accessMode: requireMode(claims.accessMode),
    policyRevisionId: requireUuid(claims.policyRevisionId),
    policyDigest: requireDigest(claims.policyDigest),
    issuedAt: requireTimestamp(claims.issuedAt),
    expiresAt: requireTimestamp(claims.expiresAt),
  });
  if (
    normalizedClaims.policyRevisionId !== PRIVACY_ACCESS_POLICY_REVISION_ID ||
    normalizedClaims.policyDigest !== PRIVACY_ACCESS_POLICY_DIGEST ||
    Date.parse(normalizedClaims.expiresAt) <=
      Date.parse(normalizedClaims.issuedAt) ||
    (normalizedClaims.accessMode === 'break_glass') !==
      (normalizedClaims.purpose === 'break_glass')
  ) {
    return invalid();
  }
  return Object.freeze({
    claims: normalizedClaims,
    tokenDigest: requireDigest(input.tokenDigest),
    accessEventId: requireUuid(input.accessEventId),
    resourceReferenceDigest: requireDigest(input.resourceReferenceDigest),
    occurredAt: requireTimestamp(input.occurredAt),
  });
}

async function rollback(client: PrivacySqlTransactionClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The public repository error remains stable even if rollback also fails.
  }
}

function parseConsumedRow(
  value: ConsumedGrantRow,
  expected: PrivacyGrantConsumptionInput,
): PrivacyGrantConsumptionReceipt {
  if (!value || typeof value !== 'object') {
    return invalid();
  }
  const receipt = Object.freeze({
    accessEventId: expected.accessEventId,
    grantId: requireUuid(value.grant_id),
    decisionId: requireUuid(value.decision_id),
    workspaceId: requireUuid(value.workspace_id),
    actorId: requireUuid(value.actor_id),
    purpose: requirePurpose(value.purpose_code),
    action: requireAction(value.action_code),
    resourceCategory: requireCategory(value.resource_category),
    accessMode: requireMode(value.access_mode),
    policyRevisionId: requireUuid(value.policy_revision_id),
    policyDigest: requireDigest(value.policy_digest),
    occurredAt: requireTimestamp(value.occurred_at),
  });
  const claims = expected.claims;
  if (
    receipt.grantId !== claims.grantId ||
    receipt.decisionId !== claims.decisionId ||
    receipt.workspaceId !== claims.workspaceId ||
    receipt.actorId !== claims.actorId ||
    receipt.purpose !== claims.purpose ||
    receipt.action !== claims.action ||
    receipt.resourceCategory !== claims.resourceCategory ||
    receipt.accessMode !== claims.accessMode ||
    receipt.policyRevisionId !== claims.policyRevisionId ||
    receipt.policyDigest !== claims.policyDigest ||
    receipt.occurredAt !== expected.occurredAt
  ) {
    return invalid();
  }
  return receipt;
}

/** PostgreSQL implementation of append-only privacy decisions and single-use grants. */
export class PostgresPrivacyAccessRepository implements PrivacyAccessRepository {
  /** Creates one repository over an explicitly owned PostgreSQL pool. */
  constructor(private readonly pool: PrivacySqlPool) {}

  /** Appends one decision and optional grant in one transaction. */
  async persistDecision(
    inputValue: PrivacyDecisionPersistenceInput,
  ): Promise<void> {
    const input = validateDecision(inputValue);
    let client: PrivacySqlTransactionClient;
    try {
      client = await this.pool.connect();
    } catch {
      return invalid();
    }
    try {
      await client.query('BEGIN');
      const decision = input.decision;
      await client.query(INSERT_DECISION_SQL, [
        decision.decisionId,
        decision.grantId ?? null,
        decision.workspaceId,
        decision.actorId,
        decision.purpose,
        decision.action,
        decision.resourceCategory,
        decision.accessMode,
        decision.outcome,
        decision.policyRevisionId,
        decision.policyDigest,
        decision.requestDigest,
        decision.reasonDigest,
        decision.issuedAt,
        decision.expiresAt ?? null,
      ]);
      if (decision.outcome === 'allowed') {
        await client.query(INSERT_GRANT_SQL, [
          decision.grantId,
          decision.decisionId,
          decision.workspaceId,
          decision.actorId,
          input.tokenDigest,
          decision.policyRevisionId,
          decision.policyDigest,
          decision.issuedAt,
          decision.expiresAt,
        ]);
      }
      await client.query('COMMIT');
    } catch {
      await rollback(client);
      return invalid();
    } finally {
      client.release();
    }
  }

  /** Atomically consumes one exact unused grant and appends one immutable event. */
  async consumeGrant(
    inputValue: PrivacyGrantConsumptionInput,
  ): Promise<PrivacyGrantConsumptionReceipt> {
    const input = validateConsumption(inputValue);
    let client: PrivacySqlTransactionClient;
    try {
      client = await this.pool.connect();
    } catch {
      return invalid();
    }
    try {
      await client.query('BEGIN');
      const update = await client.query<ConsumedGrantRow>(CONSUME_GRANT_SQL, [
        input.claims.grantId,
        input.claims.decisionId,
        input.claims.workspaceId,
        input.claims.actorId,
        input.tokenDigest,
        input.claims.policyRevisionId,
        input.claims.policyDigest,
        input.accessEventId,
        input.occurredAt,
        input.occurredAt,
      ]);
      if (!Array.isArray(update.rows) || update.rows.length !== 1) {
        return invalid();
      }
      const receipt = parseConsumedRow(update.rows[0]!, input);
      await client.query(INSERT_EVENT_SQL, [
        receipt.accessEventId,
        receipt.grantId,
        receipt.decisionId,
        receipt.workspaceId,
        receipt.actorId,
        receipt.purpose,
        receipt.action,
        receipt.resourceCategory,
        receipt.accessMode,
        receipt.policyRevisionId,
        receipt.policyDigest,
        input.resourceReferenceDigest,
        receipt.occurredAt,
      ]);
      await client.query('COMMIT');
      return receipt;
    } catch {
      await rollback(client);
      return invalid();
    } finally {
      client.release();
    }
  }
}
