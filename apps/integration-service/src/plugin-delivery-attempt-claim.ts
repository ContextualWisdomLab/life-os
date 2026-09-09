import { createHash, randomUUID } from 'node:crypto';
import type { PluginInstallationContext } from './plugin-installation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt-claim.v1' as const;
const MINIMUM_LEASE_SECONDS = 30;
const MAXIMUM_LEASE_SECONDS = 3_600;

/** Fixed claim/lease authority failure without request, token, or dependency reflection. */
export class PluginDeliveryAttemptClaimAuthorityError extends Error {
  /** Creates one credential- and token-free claim/lease failure. */
  constructor() {
    super('Plugin delivery attempt claim authority is invalid');
    this.name = 'PluginDeliveryAttemptClaimAuthorityError';
  }
}

/** Durable evidence returned after one pending delivery attempt is conditionally claimed. */
export interface PluginDeliveryAttemptClaimEvidence {
  readonly authorityVersion: typeof AUTHORITY_VERSION;
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly attemptNumber: number;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}

/** Worker-visible lease authority; the raw token is never part of durable persistence. */
export interface PluginDeliveryAttemptLease extends PluginDeliveryAttemptClaimEvidence {
  readonly claimToken: string;
}

/** Exact conditional claim command accepted by Integration-owned persistence. */
export interface PluginDeliveryAttemptClaimCommand {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly claimTokenDigest: string;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
}

/** Service-owned durable port for one deterministic pending-attempt claim. */
export interface PluginDeliveryAttemptClaimStore {
  /** Claims one due attempt only when no unexpired lease already owns it. */
  claimDue(
    command: PluginDeliveryAttemptClaimCommand,
  ): Promise<PluginDeliveryAttemptClaimEvidence | undefined>;
}

/** Raises the fixed application authority failure without reflecting hostile data. */
function invalid(): never {
  throw new PluginDeliveryAttemptClaimAuthorityError();
}

/** Collapses hostile synchronous reads into the fixed claim authority failure. */
function boundedRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalid();
  }
}

/** Keeps hostile durable values nested while collapsing persistence rejection to the fixed authority failure. */
async function boundedDependency<T>(
  read: () => Promise<T>,
): Promise<{ readonly value: T }> {
  try {
    return { value: await read() };
  } catch {
    return invalid();
  }
}

/** Validates and canonicalizes one UUIDv4 authority identifier. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

/** Validates one exact millisecond-resolution UTC instant. */
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

/** Reads the injected clock without allowing clock failures to escape the boundary. */
function currentInstant(now: () => Date): string {
  return boundedRead(() => requireInstant(now().toISOString()));
}

/** Extracts only canonical workspace and actor authority from trusted context. */
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

/** Restricts worker leases to the production 30–3600 second policy window. */
function requireLeaseSeconds(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MINIMUM_LEASE_SECONDS ||
    value > MAXIMUM_LEASE_SECONDS
  ) {
    return invalid();
  }
  return value;
}

/** Derives the fixed-length SHA-256 persistence token without storing raw claim material. */
function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Revalidates durable claim evidence against the exact normalized persistence command. */
function requireEvidence(
  value: unknown,
  command: PluginDeliveryAttemptClaimCommand,
): PluginDeliveryAttemptClaimEvidence {
  if (
    value === null ||
    typeof value !== 'object' ||
    boundedRead(() => Array.isArray(value))
  ) {
    return invalid();
  }
  const evidence = value as PluginDeliveryAttemptClaimEvidence;
  const snapshot = boundedRead(() => ({
    authorityVersion: evidence.authorityVersion,
    deliveryId: evidence.deliveryId,
    workspaceId: evidence.workspaceId,
    requestedByUserId: evidence.requestedByUserId,
    attemptNumber: evidence.attemptNumber,
    claimedAt: evidence.claimedAt,
    leaseExpiresAt: evidence.leaseExpiresAt,
  }));
  if (
    snapshot.authorityVersion !== AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    typeof snapshot.attemptNumber !== 'number' ||
    !Number.isInteger(snapshot.attemptNumber) ||
    snapshot.attemptNumber < 1 ||
    snapshot.attemptNumber > 10
  ) {
    return invalid();
  }
  const claimedAt = requireInstant(snapshot.claimedAt);
  const leaseExpiresAt = requireInstant(snapshot.leaseExpiresAt);
  if (
    claimedAt !== command.claimedAt ||
    leaseExpiresAt !== command.leaseExpiresAt
  ) {
    return invalid();
  }
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId: snapshot.deliveryId,
    workspaceId: snapshot.workspaceId,
    requestedByUserId: snapshot.requestedByUserId,
    attemptNumber: snapshot.attemptNumber,
    claimedAt,
    leaseExpiresAt,
  });
}

/**
 * Acquires one finite worker lease without granting outbound-network authority.
 *
 * The raw claim token is returned only to the caller. Persistence receives its SHA-256
 * digest and exact scope, while later execution must still revalidate its own authority.
 */
export class PluginDeliveryAttemptClaimApplication {
  /** Creates the claim application over Integration-owned durable persistence. */
  constructor(
    private readonly store: PluginDeliveryAttemptClaimStore,
    private readonly now: () => Date = () => new Date(),
    private readonly createClaimToken: () => string = randomUUID,
  ) {}

  /** Claims one due pending delivery for a bounded 30–3600 second lease. */
  async claim(
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
    leaseSecondsInput: number,
  ): Promise<PluginDeliveryAttemptLease> {
    const context = requireContext(trustedContext);
    const deliveryId = requireUuidV4(deliveryIdInput);
    const leaseSeconds = requireLeaseSeconds(leaseSecondsInput);
    const claimedAt = currentInstant(this.now);
    const claimedAtMs = new Date(claimedAt).getTime();
    const leaseExpiresAt = requireInstant(
      new Date(claimedAtMs + leaseSeconds * 1_000).toISOString(),
    );
    const claimToken = requireUuidV4(boundedRead(this.createClaimToken));
    const command = Object.freeze({
      deliveryId,
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      claimTokenDigest: digestToken(claimToken),
      claimedAt,
      leaseExpiresAt,
    });
    const { value: durable } = await boundedDependency(() =>
      this.store.claimDue(command),
    );
    if (durable === undefined) {
      return invalid();
    }
    const evidence = requireEvidence(durable, command);
    return Object.freeze({ ...evidence, claimToken });
  }
}
