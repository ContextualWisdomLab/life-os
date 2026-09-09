import { createHash } from 'node:crypto';
import type { PluginInstallationContext } from './plugin-installation';
import { pluginDeliveryAttemptRetryBackoffSeconds } from './plugin-delivery-attempt-retry-policy';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt-retry.v1' as const;
const MAXIMUM_ATTEMPTS = 10;

/** Fixed retry-transition failure without claim token or dependency detail. */
export class PluginDeliveryAttemptRetryAuthorityError extends Error {
  /** Creates one credential- and token-free retry authority failure. */
  constructor() {
    super('Plugin delivery attempt retry authority is invalid');
    this.name = 'PluginDeliveryAttemptRetryAuthorityError';
  }
}

/** Exact retryable-failure command accepted by Integration-owned persistence. */
export interface PluginDeliveryAttemptRetryCommand {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly claimTokenDigest: string;
  readonly occurredAt: string;
}

/** Durable retry transition returned after the active claim is consumed. */
export interface PluginDeliveryAttemptRetryEvidence {
  readonly authorityVersion: typeof AUTHORITY_VERSION;
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly deliveryStatus: 'pending' | 'failed';
  readonly occurredAt: string;
  readonly nextAttemptAt: string | null;
  readonly terminalAt: string | null;
  readonly outcomeCode: 'retryable_failure' | 'attempt_limit';
}

/** Integration-owned durable port for one claim-bound retry transition. */
export interface PluginDeliveryAttemptRetryStore {
  /** Consumes the exact active claim and records either bounded retry or terminal exhaustion. */
  recordRetryableFailure(
    command: PluginDeliveryAttemptRetryCommand,
  ): Promise<PluginDeliveryAttemptRetryEvidence | undefined>;
}

/** Terminates malformed retry authority without reflecting claim or dependency detail. */
function invalid(): never {
  throw new PluginDeliveryAttemptRetryAuthorityError();
}

/** Collapses hostile synchronous authority reads into the fixed retry error. */
function boundedRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalid();
  }
}

/** Collapses durable dependency rejection into the fixed retry error. */
async function boundedDependency<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    return invalid();
  }
}

/** Canonicalizes one scoped UUIDv4 before persistence or equality checks. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

/** Requires an already-canonical UUIDv4 for sensitive claim-token input. */
function requireCanonicalUuidV4(value: unknown): string {
  const canonical = requireUuidV4(value);
  if (value !== canonical) {
    return invalid();
  }
  return canonical;
}

/** Requires one exact millisecond UTC instant for retry lifecycle equality. */
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

/** Snapshots authenticated workspace and actor scope before retry persistence is exercised. */
function requireContext(value: unknown): PluginInstallationContext {
  if (value === null || typeof value !== 'object') {
    return invalid();
  }
  if (boundedRead(() => Array.isArray(value))) {
    return invalid();
  }
  const context = value as PluginInstallationContext;
  const [workspaceId, actorUserId] = boundedRead(
    () => [context.workspaceId, context.actorUserId] as const,
  );
  return Object.freeze({
    workspaceId: requireUuidV4(workspaceId),
    actorUserId: requireUuidV4(actorUserId),
  });
}

/** Reads the trusted clock through the bounded retry-authority boundary. */
function currentInstant(now: () => Date): string {
  return boundedRead(() => requireInstant(now().toISOString()));
}

/** Hashes the one-time claim token before any value can cross the persistence boundary. */
function digestClaimToken(value: unknown): string {
  const token = requireCanonicalUuidV4(value);
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Derives the deterministic next-attempt instant from the canonical retry policy. */
function retryAt(occurredAt: string, attemptNumber: number): string {
  const delaySeconds = pluginDeliveryAttemptRetryBackoffSeconds(attemptNumber);
  return requireInstant(
    new Date(
      new Date(occurredAt).getTime() + delaySeconds * 1_000,
    ).toISOString(),
  );
}

/** Revalidates durable retry evidence against exact command scope, counters, outcome, and schedule. */
function requireEvidence(
  value: unknown,
  command: PluginDeliveryAttemptRetryCommand,
): PluginDeliveryAttemptRetryEvidence {
  if (value === null || typeof value !== 'object') {
    return invalid();
  }
  if (boundedRead(() => Array.isArray(value))) {
    return invalid();
  }
  const evidence = value as PluginDeliveryAttemptRetryEvidence;
  const snapshot = boundedRead(() => ({
    authorityVersion: evidence.authorityVersion,
    deliveryId: evidence.deliveryId,
    workspaceId: evidence.workspaceId,
    requestedByUserId: evidence.requestedByUserId,
    attemptNumber: evidence.attemptNumber,
    maxAttempts: evidence.maxAttempts,
    deliveryStatus: evidence.deliveryStatus,
    occurredAt: evidence.occurredAt,
    nextAttemptAt: evidence.nextAttemptAt,
    terminalAt: evidence.terminalAt,
    outcomeCode: evidence.outcomeCode,
  }));
  if (
    snapshot.authorityVersion !== AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    typeof snapshot.attemptNumber !== 'number' ||
    !Number.isInteger(snapshot.attemptNumber) ||
    snapshot.attemptNumber < 1 ||
    typeof snapshot.maxAttempts !== 'number' ||
    !Number.isInteger(snapshot.maxAttempts) ||
    snapshot.maxAttempts < 1 ||
    snapshot.maxAttempts > MAXIMUM_ATTEMPTS ||
    snapshot.attemptNumber > snapshot.maxAttempts
  ) {
    return invalid();
  }
  const occurredAt = requireInstant(snapshot.occurredAt);
  if (occurredAt !== command.occurredAt) {
    return invalid();
  }

  if (snapshot.deliveryStatus === 'pending') {
    if (
      snapshot.attemptNumber >= snapshot.maxAttempts ||
      snapshot.outcomeCode !== 'retryable_failure' ||
      snapshot.terminalAt !== null ||
      requireInstant(snapshot.nextAttemptAt) !==
        retryAt(occurredAt, snapshot.attemptNumber)
    ) {
      return invalid();
    }
  } else if (snapshot.deliveryStatus === 'failed') {
    if (
      snapshot.attemptNumber !== snapshot.maxAttempts ||
      snapshot.outcomeCode !== 'attempt_limit' ||
      snapshot.nextAttemptAt !== null ||
      requireInstant(snapshot.terminalAt) !== occurredAt
    ) {
      return invalid();
    }
  } else {
    return invalid();
  }

  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    attemptNumber: snapshot.attemptNumber,
    maxAttempts: snapshot.maxAttempts,
    deliveryStatus: snapshot.deliveryStatus,
    occurredAt,
    nextAttemptAt: snapshot.nextAttemptAt,
    terminalAt: snapshot.terminalAt,
    outcomeCode: snapshot.outcomeCode,
  });
}

/**
 * Consumes one active worker claim after a retryable failure and returns only bounded lifecycle evidence.
 *
 * The raw claim token is hashed before persistence. This authority schedules lifecycle state only; it
 * does not grant provider execution, credential access, or outbound-network authority.
 */
export class PluginDeliveryAttemptRetryApplication {
  /** Creates the retry application over Integration-owned durable persistence. */
  constructor(
    private readonly store: PluginDeliveryAttemptRetryStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Records one retryable failure against the exact active claim. */
  async recordRetryableFailure(
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
    claimTokenInput: string,
  ): Promise<PluginDeliveryAttemptRetryEvidence> {
    const context = requireContext(trustedContext);
    const command = Object.freeze({
      deliveryId: requireUuidV4(deliveryIdInput),
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      claimTokenDigest: digestClaimToken(claimTokenInput),
      occurredAt: currentInstant(this.now),
    });
    const durable = await boundedDependency(() =>
      this.store.recordRetryableFailure(command),
    );
    if (durable === undefined) {
      return invalid();
    }
    return requireEvidence(durable, command);
  }
}
