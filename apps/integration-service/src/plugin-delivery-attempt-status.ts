import type { PluginInstallationContext } from './plugin-installation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt-status.v1' as const;
const MINIMUM_ATTEMPTS = 1;
const MAXIMUM_ATTEMPTS = 10;

/** Fixed fail-closed status-authority failure without request or backend reflection. */
export class PluginDeliveryAttemptStatusAuthorityError extends Error {
  /** Creates one credential-, payload-, and backend-detail-free authority failure. */
  constructor() {
    super('Plugin delivery attempt status authority is invalid');
    this.name = 'PluginDeliveryAttemptStatusAuthorityError';
  }
}

/** Exact tenant/user-scoped status query passed to Integration-owned persistence. */
export interface PluginDeliveryAttemptStatusCommand {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly checkedAt: string;
}

/**
 * Credential-free durable operator snapshot for one plugin delivery attempt.
 *
 * Claim material is deliberately reduced to state. Raw claim tokens and their
 * durable digests remain outside this contract, and this evidence grants no
 * outbound-network or provider-execution authority.
 */
export interface PluginDeliveryAttemptStatusEvidence {
  readonly authorityVersion: typeof AUTHORITY_VERSION;
  readonly deliveryId: string;
  readonly grantId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly deliveryStatus: 'pending' | 'paused' | 'failed' | 'dead_lettered';
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly nextAttemptAt: string | null;
  readonly terminalAt: string | null;
  readonly lastOutcomeCode: 'retryable_failure' | 'attempt_limit' | null;
  readonly controlSequence: number;
  readonly claimState: 'unclaimed' | 'active' | 'expired';
  readonly checkedAt: string;
}

/** Read-only Integration-owned persistence port for durable delivery status. */
export interface PluginDeliveryAttemptStatusStore {
  /** Reads one exact scoped status snapshot, or no evidence when scope is absent. */
  read(
    command: PluginDeliveryAttemptStatusCommand,
  ): Promise<PluginDeliveryAttemptStatusEvidence | undefined>;
}

/** Terminates malformed or absent status authority with the fixed public error. */
function invalid(): never {
  throw new PluginDeliveryAttemptStatusAuthorityError();
}

/** Collapses hostile synchronous evidence reads into the fixed status-authority failure. */
function boundedRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalid();
  }
}

/** Collapses persistence rejection into the fixed status-authority failure. */
async function boundedDependency<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    return invalid();
  }
}

/** Requires an object-shaped authority envelope without trusting accessors or arrays. */
function requireObject(value: unknown): Record<string, unknown> {
  const candidate = boundedRead(() => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  });
  if (!candidate) {
    return invalid();
  }
  return candidate;
}

/** Canonicalizes one status-scope UUIDv4 before comparison or persistence use. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

/** Requires one exact millisecond UTC instant for deterministic lifecycle ordering. */
function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    return invalid();
  }
  return value;
}

/** Preserves an absent lifecycle instant while validating every present timestamp. */
function requireNullableInstant(value: unknown): string | null {
  return value === null ? null : requireInstant(value);
}

/** Reads the trusted clock through the same bounded status-authority boundary. */
function currentInstant(now: () => Date): string {
  return boundedRead(() => requireInstant(now().toISOString()));
}

/** Snapshots authenticated workspace and actor scope before querying durable status. */
function requireContext(value: unknown): PluginInstallationContext {
  const context = requireObject(value);
  const [workspaceId, actorUserId] = boundedRead(
    () => [context.workspaceId, context.actorUserId] as const,
  );
  return Object.freeze({
    workspaceId: requireUuidV4(workspaceId),
    actorUserId: requireUuidV4(actorUserId),
  });
}

/** Requires an integer inside an explicit lifecycle bound. */
function requireSmallInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid();
  }
  return value;
}

/** Admits only delivery lifecycle states represented by the public status contract. */
function requireStatus(
  value: unknown,
): PluginDeliveryAttemptStatusEvidence['deliveryStatus'] {
  if (
    value !== 'pending' &&
    value !== 'paused' &&
    value !== 'failed' &&
    value !== 'dead_lettered'
  ) {
    return invalid();
  }
  return value;
}

/** Admits only the bounded retry outcomes safe to expose in status evidence. */
function requireOutcome(
  value: unknown,
): PluginDeliveryAttemptStatusEvidence['lastOutcomeCode'] {
  if (
    value !== null &&
    value !== 'retryable_failure' &&
    value !== 'attempt_limit'
  ) {
    return invalid();
  }
  return value;
}

/** Reduces claim persistence to the three non-secret operator-visible claim states. */
function requireClaimState(
  value: unknown,
): PluginDeliveryAttemptStatusEvidence['claimState'] {
  if (value !== 'unclaimed' && value !== 'active' && value !== 'expired') {
    return invalid();
  }
  return value;
}

/** Rejects impossible combinations of status, attempts, retry schedule, terminal state, outcome, and claim state. */
function validateLifecycle(
  status: PluginDeliveryAttemptStatusEvidence['deliveryStatus'],
  attemptCount: number,
  maxAttempts: number,
  nextAttemptAt: string | null,
  terminalAt: string | null,
  outcome: PluginDeliveryAttemptStatusEvidence['lastOutcomeCode'],
  claimState: PluginDeliveryAttemptStatusEvidence['claimState'],
): void {
  const claimed = claimState === 'active' || claimState === 'expired';
  const initialPending =
    status === 'pending' &&
    attemptCount === 0 &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    outcome === null &&
    claimState === 'unclaimed';
  const claimedPending =
    status === 'pending' &&
    attemptCount >= 1 &&
    attemptCount <= maxAttempts &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    (outcome === null || outcome === 'retryable_failure') &&
    claimed;
  const scheduledRetry =
    status === 'pending' &&
    attemptCount >= 1 &&
    attemptCount < maxAttempts &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    outcome === 'retryable_failure' &&
    claimState === 'unclaimed';
  const paused =
    status === 'paused' &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    claimState === 'unclaimed' &&
    ((attemptCount === 0 && outcome === null) ||
      (attemptCount >= 1 &&
        attemptCount < maxAttempts &&
        outcome === 'retryable_failure'));
  const failed =
    status === 'failed' &&
    attemptCount === maxAttempts &&
    nextAttemptAt === null &&
    terminalAt !== null &&
    outcome === 'attempt_limit' &&
    claimState === 'unclaimed';
  const deadLettered =
    status === 'dead_lettered' &&
    attemptCount === maxAttempts &&
    nextAttemptAt === null &&
    terminalAt !== null &&
    outcome === 'attempt_limit' &&
    claimState === 'unclaimed';

  if (
    !initialPending &&
    !claimedPending &&
    !scheduledRetry &&
    !paused &&
    !failed &&
    !deadLettered
  ) {
    return invalid();
  }
}

/** Revalidates one durable status snapshot against its exact request scope and lifecycle invariants. */
function requireEvidence(
  value: unknown,
  command: PluginDeliveryAttemptStatusCommand,
): PluginDeliveryAttemptStatusEvidence {
  const evidence = requireObject(value);
  const snapshot = boundedRead(() => ({
    authorityVersion: evidence.authorityVersion,
    deliveryId: evidence.deliveryId,
    grantId: evidence.grantId,
    installationId: evidence.installationId,
    workspaceId: evidence.workspaceId,
    requestedByUserId: evidence.requestedByUserId,
    deliveryStatus: evidence.deliveryStatus,
    attemptCount: evidence.attemptCount,
    maxAttempts: evidence.maxAttempts,
    requestedAt: evidence.requestedAt,
    updatedAt: evidence.updatedAt,
    nextAttemptAt: evidence.nextAttemptAt,
    terminalAt: evidence.terminalAt,
    lastOutcomeCode: evidence.lastOutcomeCode,
    controlSequence: evidence.controlSequence,
    claimState: evidence.claimState,
    checkedAt: evidence.checkedAt,
  }));
  if (snapshot.authorityVersion !== AUTHORITY_VERSION) {
    return invalid();
  }
  const deliveryId = requireUuidV4(snapshot.deliveryId);
  const workspaceId = requireUuidV4(snapshot.workspaceId);
  const requestedByUserId = requireUuidV4(snapshot.requestedByUserId);
  const grantId = requireUuidV4(snapshot.grantId);
  const installationId = requireUuidV4(snapshot.installationId);
  const maxAttempts = requireSmallInteger(
    snapshot.maxAttempts,
    MINIMUM_ATTEMPTS,
    MAXIMUM_ATTEMPTS,
  );
  const attemptCount = requireSmallInteger(
    snapshot.attemptCount,
    0,
    maxAttempts,
  );
  const controlSequence = requireSmallInteger(
    snapshot.controlSequence,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const requestedAt = requireInstant(snapshot.requestedAt);
  const updatedAt = requireInstant(snapshot.updatedAt);
  const nextAttemptAt = requireNullableInstant(snapshot.nextAttemptAt);
  const terminalAt = requireNullableInstant(snapshot.terminalAt);
  const checkedAt = requireInstant(snapshot.checkedAt);
  const deliveryStatus = requireStatus(snapshot.deliveryStatus);
  const lastOutcomeCode = requireOutcome(snapshot.lastOutcomeCode);
  const claimState = requireClaimState(snapshot.claimState);

  if (
    deliveryId !== command.deliveryId ||
    workspaceId !== command.workspaceId ||
    requestedByUserId !== command.requestedByUserId ||
    checkedAt !== command.checkedAt ||
    new Date(updatedAt).getTime() < new Date(requestedAt).getTime() ||
    new Date(updatedAt).getTime() > new Date(checkedAt).getTime() ||
    new Date(checkedAt).getTime() < new Date(requestedAt).getTime() ||
    (nextAttemptAt !== null &&
      new Date(nextAttemptAt).getTime() < new Date(requestedAt).getTime()) ||
    (terminalAt !== null &&
      (new Date(terminalAt).getTime() < new Date(requestedAt).getTime() ||
        new Date(terminalAt).getTime() > new Date(updatedAt).getTime()))
  ) {
    return invalid();
  }

  validateLifecycle(
    deliveryStatus,
    attemptCount,
    maxAttempts,
    nextAttemptAt,
    terminalAt,
    lastOutcomeCode,
    claimState,
  );

  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId,
    grantId,
    installationId,
    workspaceId,
    requestedByUserId,
    deliveryStatus,
    attemptCount,
    maxAttempts,
    requestedAt,
    updatedAt,
    nextAttemptAt,
    terminalAt,
    lastOutcomeCode,
    controlSequence,
    claimState,
    checkedAt,
  });
}

/** Read-only application boundary for exact scoped, restart-recoverable status. */
export class PluginDeliveryAttemptStatusApplication {
  /** Creates the status reader over Integration-owned persistence and a trusted clock. */
  constructor(
    private readonly store: PluginDeliveryAttemptStatusStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Reads one credential-free durable snapshot for the exact trusted scope. */
  async read(
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
  ): Promise<PluginDeliveryAttemptStatusEvidence> {
    const context = requireContext(trustedContext);
    const deliveryId = requireUuidV4(deliveryIdInput);
    const checkedAt = currentInstant(this.now);
    const command = Object.freeze({
      deliveryId,
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      checkedAt,
    });
    const evidence = await boundedDependency(() => this.store.read(command));
    if (!evidence) {
      return invalid();
    }
    return requireEvidence(evidence, command);
  }
}
