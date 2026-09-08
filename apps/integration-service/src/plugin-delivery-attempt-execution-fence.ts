import { createHash } from 'node:crypto';
import type { PluginInstallationContext } from './plugin-installation';

const AUTHORITY_VERSION =
  'life-os.plugin-delivery-attempt-execution-fence.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MINIMUM_ATTEMPT_NUMBER = 1;
const MAXIMUM_ATTEMPT_NUMBER = 10;

/** Fixed fail-closed execution-fence failure without request or backend reflection. */
export class PluginDeliveryAttemptExecutionFenceAuthorityError extends Error {
  /** Creates one credential- and payload-free authority failure. */
  constructor() {
    super('Plugin delivery attempt execution fence authority is invalid');
    this.name = 'PluginDeliveryAttemptExecutionFenceAuthorityError';
  }
}

/** Exact durable authority lookup immediately before provider execution. */
export interface PluginDeliveryAttemptExecutionFenceCommand {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly claimTokenDigest: string;
  readonly checkedAt: string;
}

/** Durable evidence that the claim and its owning authorities are active now. */
export interface PluginDeliveryAttemptExecutionFenceEvidence {
  readonly authorityVersion: typeof AUTHORITY_VERSION;
  readonly deliveryId: string;
  readonly grantId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly attemptNumber: number;
  readonly checkedAt: string;
  readonly claimExpiresAt: string;
}

/** Service-owned persistence port for the current pre-execution authority check. */
export interface PluginDeliveryAttemptExecutionFenceStore {
  /** Returns current durable authority or undefined when any required authority is absent. */
  check(
    command: PluginDeliveryAttemptExecutionFenceCommand,
  ): Promise<PluginDeliveryAttemptExecutionFenceEvidence | undefined>;
}

function invalid(): never {
  throw new PluginDeliveryAttemptExecutionFenceAuthorityError();
}

function boundedRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalid();
  }
}

async function boundedDependency<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    return invalid();
  }
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

function requireInstant(value: unknown): string {
  const candidate = boundedRead(() =>
    value instanceof Date ? value.toISOString() : value,
  );
  if (typeof candidate !== 'string' || !ISO_INSTANT_PATTERN.test(candidate)) {
    return invalid();
  }
  const instant = new Date(candidate);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== candidate) {
    return invalid();
  }
  return candidate;
}

function currentInstant(now: () => Date): string {
  try {
    return requireInstant(now().toISOString());
  } catch {
    return invalid();
  }
}

function requireContext(value: unknown): PluginInstallationContext {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
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

function digestClaimToken(rawClaimToken: unknown): string {
  const claimToken = requireUuidV4(rawClaimToken);
  return createHash('sha256').update(claimToken, 'utf8').digest('hex');
}

function requireEvidence(
  value: unknown,
  command: PluginDeliveryAttemptExecutionFenceCommand,
): PluginDeliveryAttemptExecutionFenceEvidence {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  const evidence = value as PluginDeliveryAttemptExecutionFenceEvidence;
  const snapshot = boundedRead(() => ({
    authorityVersion: evidence.authorityVersion,
    deliveryId: evidence.deliveryId,
    grantId: evidence.grantId,
    installationId: evidence.installationId,
    workspaceId: evidence.workspaceId,
    requestedByUserId: evidence.requestedByUserId,
    attemptNumber: evidence.attemptNumber,
    checkedAt: evidence.checkedAt,
    claimExpiresAt: evidence.claimExpiresAt,
  }));
  if (
    snapshot.authorityVersion !== AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    typeof snapshot.attemptNumber !== 'number' ||
    !Number.isInteger(snapshot.attemptNumber) ||
    snapshot.attemptNumber < MINIMUM_ATTEMPT_NUMBER ||
    snapshot.attemptNumber > MAXIMUM_ATTEMPT_NUMBER
  ) {
    return invalid();
  }
  const checkedAt = requireInstant(snapshot.checkedAt);
  const claimExpiresAt = requireInstant(snapshot.claimExpiresAt);
  if (
    checkedAt !== command.checkedAt ||
    new Date(claimExpiresAt).getTime() <= new Date(checkedAt).getTime()
  ) {
    return invalid();
  }
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId: requireUuidV4(snapshot.deliveryId),
    grantId: requireUuidV4(snapshot.grantId),
    installationId: requireUuidV4(snapshot.installationId),
    workspaceId: requireUuidV4(snapshot.workspaceId),
    requestedByUserId: requireUuidV4(snapshot.requestedByUserId),
    attemptNumber: snapshot.attemptNumber,
    checkedAt,
    claimExpiresAt,
  });
}

/**
 * Revalidates one claimed delivery immediately before provider execution.
 *
 * Passing this fence is Integration authority only. It does not grant DNS/IP,
 * redirect, proxy, connect, credential, timeout, or response-size authority.
 */
export class PluginDeliveryAttemptExecutionFenceApplication {
  /** Creates the application over one Integration-owned durable authority store. */
  constructor(
    private readonly store: PluginDeliveryAttemptExecutionFenceStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Proves that the exact claim and its owning authorities are still active now. */
  async check(
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
    rawClaimToken: string,
  ): Promise<PluginDeliveryAttemptExecutionFenceEvidence> {
    const context = requireContext(trustedContext);
    const deliveryId = requireUuidV4(deliveryIdInput);
    const checkedAt = currentInstant(this.now);
    const command = Object.freeze({
      deliveryId,
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      claimTokenDigest: digestClaimToken(rawClaimToken),
      checkedAt,
    });
    const evidence = await boundedDependency(() => this.store.check(command));
    if (evidence === undefined) {
      return invalid();
    }
    return requireEvidence(evidence, command);
  }
}
