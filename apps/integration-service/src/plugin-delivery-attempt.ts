import type { PluginInstallationContext } from './plugin-installation';
import type { PluginDeliveryOriginGrantRecord } from './plugin-delivery-origin-authority';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt.v1' as const;
const MINIMUM_ATTEMPTS = 1;
const MAXIMUM_ATTEMPTS = 10;

/** Fixed fail-closed delivery-attempt authority failure without request reflection. */
export class PluginDeliveryAttemptAuthorityError extends Error {
  /** Creates one credential- and payload-free authority failure. */
  constructor() {
    super('Plugin delivery attempt authority is invalid');
    this.name = 'PluginDeliveryAttemptAuthorityError';
  }
}

/**
 * Durable Integration-owned work identity for one future plugin delivery.
 *
 * The aggregate intentionally stores no origin, credential, request payload, DNS result,
 * or network authorization. Those remain behind their owning boundaries. This record is
 * only durable scheduling truth and cannot itself grant outbound access.
 */
export interface PluginDeliveryAttemptRecord {
  readonly authorityVersion: typeof AUTHORITY_VERSION;
  readonly deliveryId: string;
  readonly grantId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly status: 'pending';
  readonly attemptCount: 0;
  readonly maxAttempts: number;
  readonly requestedAt: string;
  readonly updatedAt: string;
  readonly nextAttemptAt: string;
  readonly terminalAt: null;
  readonly lastOutcomeCode: null;
}

/** Service-owned durable port for idempotent delivery-attempt admission. */
export interface PluginDeliveryAttemptStore {
  /** Creates one pending attempt or returns the exact durable idempotency winner. */
  createIfAbsent(
    record: PluginDeliveryAttemptRecord,
  ): Promise<PluginDeliveryAttemptRecord>;
}

/** Read-only authority required to prove an exact delivery-origin grant is active now. */
export interface PluginDeliveryAttemptOriginReader {
  /** Reads one grant through current installation and host-origin authority. */
  getGrant(
    trustedContext: PluginInstallationContext,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined>;
}

/** Host request to create one durable idempotent delivery work identity. */
export interface SchedulePluginDeliveryAttemptInput {
  readonly deliveryId: string;
  readonly grantId: string;
  readonly maxAttempts: number;
}

function invalid(): never {
  throw new PluginDeliveryAttemptAuthorityError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

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
  return Object.freeze({
    workspaceId: requireUuidV4(context.workspaceId),
    actorUserId: requireUuidV4(context.actorUserId),
  });
}

function requireInput(value: unknown): SchedulePluginDeliveryAttemptInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  const input = value as SchedulePluginDeliveryAttemptInput;
  if (
    typeof input.maxAttempts !== 'number' ||
    !Number.isInteger(input.maxAttempts) ||
    input.maxAttempts < MINIMUM_ATTEMPTS ||
    input.maxAttempts > MAXIMUM_ATTEMPTS
  ) {
    return invalid();
  }
  return Object.freeze({
    deliveryId: requireUuidV4(input.deliveryId),
    grantId: requireUuidV4(input.grantId),
    maxAttempts: input.maxAttempts,
  });
}

function freezeRecord(
  record: PluginDeliveryAttemptRecord,
): PluginDeliveryAttemptRecord {
  return Object.freeze({ ...record });
}

function requireRecord(value: unknown): PluginDeliveryAttemptRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  const record = value as PluginDeliveryAttemptRecord;
  if (
    record.authorityVersion !== AUTHORITY_VERSION ||
    record.status !== 'pending' ||
    record.attemptCount !== 0 ||
    record.terminalAt !== null ||
    record.lastOutcomeCode !== null ||
    typeof record.maxAttempts !== 'number' ||
    !Number.isInteger(record.maxAttempts) ||
    record.maxAttempts < MINIMUM_ATTEMPTS ||
    record.maxAttempts > MAXIMUM_ATTEMPTS
  ) {
    return invalid();
  }
  const requestedAt = requireInstant(record.requestedAt);
  const updatedAt = requireInstant(record.updatedAt);
  const nextAttemptAt = requireInstant(record.nextAttemptAt);
  if (
    new Date(updatedAt).getTime() < new Date(requestedAt).getTime() ||
    new Date(nextAttemptAt).getTime() < new Date(requestedAt).getTime()
  ) {
    return invalid();
  }
  return freezeRecord({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId: requireUuidV4(record.deliveryId),
    grantId: requireUuidV4(record.grantId),
    installationId: requireUuidV4(record.installationId),
    workspaceId: requireUuidV4(record.workspaceId),
    requestedByUserId: requireUuidV4(record.requestedByUserId),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: record.maxAttempts,
    requestedAt,
    updatedAt,
    nextAttemptAt,
    terminalAt: null,
    lastOutcomeCode: null,
  });
}

function requireActiveGrant(
  grant: PluginDeliveryOriginGrantRecord | undefined,
  context: PluginInstallationContext,
  installationId: string,
  grantId: string,
  authorityInstant: string,
): PluginDeliveryOriginGrantRecord {
  if (
    !grant ||
    grant.grantId !== grantId ||
    grant.installationId !== installationId ||
    grant.workspaceId !== context.workspaceId ||
    grant.grantedByUserId !== context.actorUserId ||
    grant.status !== 'active' ||
    grant.revokedAt !== null ||
    new Date(requireInstant(grant.grantedAt)).getTime() >
      new Date(authorityInstant).getTime()
  ) {
    return invalid();
  }
  return grant;
}

function sameAdmission(
  durable: PluginDeliveryAttemptRecord,
  candidate: PluginDeliveryAttemptRecord,
): boolean {
  return (
    durable.authorityVersion === candidate.authorityVersion &&
    durable.deliveryId === candidate.deliveryId &&
    durable.grantId === candidate.grantId &&
    durable.installationId === candidate.installationId &&
    durable.workspaceId === candidate.workspaceId &&
    durable.requestedByUserId === candidate.requestedByUserId &&
    durable.status === 'pending' &&
    durable.attemptCount === 0 &&
    durable.maxAttempts === candidate.maxAttempts &&
    durable.terminalAt === null &&
    durable.lastOutcomeCode === null &&
    new Date(durable.requestedAt).getTime() <=
      new Date(candidate.requestedAt).getTime() &&
    new Date(durable.updatedAt).getTime() <=
      new Date(candidate.updatedAt).getTime() &&
    new Date(durable.nextAttemptAt).getTime() <=
      new Date(candidate.nextAttemptAt).getTime()
  );
}

/**
 * Admits durable delivery work only behind current installation/origin authority.
 *
 * This application service deliberately has no network port. Execution, retry outcomes,
 * dead-lettering and connect-time egress authorization are successor lifecycle slices.
 */
export class PluginDeliveryAttemptApplication {
  /** Creates the application over service-owned persistence and host-origin authority. */
  constructor(
    private readonly store: PluginDeliveryAttemptStore,
    private readonly origins: PluginDeliveryAttemptOriginReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Creates one idempotent pending work item after current host-origin authority is proven. */
  async schedule(
    trustedContext: PluginInstallationContext,
    installationIdInput: string,
    inputValue: SchedulePluginDeliveryAttemptInput,
  ): Promise<PluginDeliveryAttemptRecord> {
    const context = requireContext(trustedContext);
    const installationId = requireUuidV4(installationIdInput);
    const input = requireInput(inputValue);
    const requestedAt = currentInstant(this.now);
    const grant = requireActiveGrant(
      await this.origins.getGrant(context, installationId, input.grantId),
      context,
      installationId,
      input.grantId,
      requestedAt,
    );
    const candidate = freezeRecord({
      authorityVersion: AUTHORITY_VERSION,
      deliveryId: input.deliveryId,
      grantId: grant.grantId,
      installationId,
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: input.maxAttempts,
      requestedAt,
      updatedAt: requestedAt,
      nextAttemptAt: requestedAt,
      terminalAt: null,
      lastOutcomeCode: null,
    });
    const durable = requireRecord(await this.store.createIfAbsent(candidate));
    if (!sameAdmission(durable, candidate)) {
      return invalid();
    }
    return durable;
  }
}
