import type { PluginInstallationContext } from './plugin-installation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt-control.v1' as const;

/** Fixed delivery-control failure without persistence or provider detail. */
export class PluginDeliveryAttemptControlAuthorityError extends Error {
  /** Creates one credential-free control authority failure. */
  constructor() {
    super('Plugin delivery attempt control authority is invalid');
    this.name = 'PluginDeliveryAttemptControlAuthorityError';
  }
}

/** Exact scoped command accepted by Integration-owned delivery-control persistence. */
export interface PluginDeliveryAttemptControlCommand {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly occurredAt: string;
}

/** Bounded durable evidence returned after one explicit delivery-control transition. */
export interface PluginDeliveryAttemptControlEvidence {
  readonly authorityVersion: typeof AUTHORITY_VERSION;
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly controlSequence: number;
  readonly controlCode: 'pause' | 'resume' | 'dead_letter';
  readonly deliveryStatus: 'paused' | 'pending' | 'dead_lettered';
  readonly occurredAt: string;
  readonly nextAttemptAt: string | null;
  readonly terminalAt: string | null;
}

/** Integration-owned durable port for explicit pause, resume and dead-letter transitions. */
export interface PluginDeliveryAttemptControlStore {
  /** Pauses one exact unclaimed pending delivery without consuming its retry identity. */
  pause(
    command: PluginDeliveryAttemptControlCommand,
  ): Promise<PluginDeliveryAttemptControlEvidence | undefined>;
  /** Resumes one exact paused delivery as immediately due without resetting its retry identity. */
  resume(
    command: PluginDeliveryAttemptControlCommand,
  ): Promise<PluginDeliveryAttemptControlEvidence | undefined>;
  /** Dead-letters one exact terminal retry-exhausted delivery while preserving its terminal instant. */
  deadLetter(
    command: PluginDeliveryAttemptControlCommand,
  ): Promise<PluginDeliveryAttemptControlEvidence | undefined>;
}

function invalid(): never {
  throw new PluginDeliveryAttemptControlAuthorityError();
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
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    return invalid();
  }
  return value;
}

function requireNullableInstant(value: unknown): string | null {
  return value === null ? null : requireInstant(value);
}

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

function currentInstant(now: () => Date): string {
  return boundedRead(() => requireInstant(now().toISOString()));
}

function requireEvidence(
  value: unknown,
  command: PluginDeliveryAttemptControlCommand,
  expectedCode: PluginDeliveryAttemptControlEvidence['controlCode'],
): PluginDeliveryAttemptControlEvidence {
  if (value === null || typeof value !== 'object') {
    return invalid();
  }
  if (boundedRead(() => Array.isArray(value))) {
    return invalid();
  }
  const evidence = value as PluginDeliveryAttemptControlEvidence;
  const snapshot = boundedRead(() => ({
    authorityVersion: evidence.authorityVersion,
    deliveryId: evidence.deliveryId,
    workspaceId: evidence.workspaceId,
    requestedByUserId: evidence.requestedByUserId,
    controlSequence: evidence.controlSequence,
    controlCode: evidence.controlCode,
    deliveryStatus: evidence.deliveryStatus,
    occurredAt: evidence.occurredAt,
    nextAttemptAt: evidence.nextAttemptAt,
    terminalAt: evidence.terminalAt,
  }));
  if (
    snapshot.authorityVersion !== AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    snapshot.controlCode !== expectedCode ||
    typeof snapshot.controlSequence !== 'number' ||
    !Number.isInteger(snapshot.controlSequence) ||
    snapshot.controlSequence < 1
  ) {
    return invalid();
  }
  const occurredAt = requireInstant(snapshot.occurredAt);
  if (occurredAt !== command.occurredAt) {
    return invalid();
  }
  const nextAttemptAt = requireNullableInstant(snapshot.nextAttemptAt);
  const terminalAt = requireNullableInstant(snapshot.terminalAt);

  if (expectedCode === 'pause') {
    if (
      snapshot.deliveryStatus !== 'paused' ||
      nextAttemptAt === null ||
      terminalAt !== null
    ) {
      return invalid();
    }
  } else if (expectedCode === 'resume') {
    if (
      snapshot.deliveryStatus !== 'pending' ||
      nextAttemptAt !== occurredAt ||
      terminalAt !== null
    ) {
      return invalid();
    }
  } else if (
    snapshot.deliveryStatus !== 'dead_lettered' ||
    nextAttemptAt !== null ||
    terminalAt === null ||
    new Date(terminalAt).getTime() > new Date(occurredAt).getTime()
  ) {
    return invalid();
  }

  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    controlSequence: snapshot.controlSequence,
    controlCode: expectedCode,
    deliveryStatus: snapshot.deliveryStatus,
    occurredAt,
    nextAttemptAt,
    terminalAt,
  });
}

/**
 * Applies explicit operator lifecycle controls to one Integration-owned delivery attempt.
 *
 * This authority can pause scheduling, resume scheduling, or mark retry exhaustion as dead-lettered.
 * It does not grant provider execution, credential access, destination selection, or outbound-network authority.
 */
export class PluginDeliveryAttemptControlApplication {
  /** Creates the application over Integration-owned durable control persistence. */
  constructor(
    private readonly store: PluginDeliveryAttemptControlStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Pauses one exact unclaimed pending delivery. */
  async pause(
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
  ): Promise<PluginDeliveryAttemptControlEvidence> {
    return this.apply('pause', trustedContext, deliveryIdInput);
  }

  /** Resumes one exact paused delivery as immediately due. */
  async resume(
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
  ): Promise<PluginDeliveryAttemptControlEvidence> {
    return this.apply('resume', trustedContext, deliveryIdInput);
  }

  /** Marks one exact terminal retry-exhausted delivery as dead-lettered. */
  async deadLetter(
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
  ): Promise<PluginDeliveryAttemptControlEvidence> {
    return this.apply('dead_letter', trustedContext, deliveryIdInput);
  }

  private async apply(
    controlCode: PluginDeliveryAttemptControlEvidence['controlCode'],
    trustedContext: PluginInstallationContext,
    deliveryIdInput: string,
  ): Promise<PluginDeliveryAttemptControlEvidence> {
    const context = requireContext(trustedContext);
    const command = Object.freeze({
      deliveryId: requireUuidV4(deliveryIdInput),
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      occurredAt: currentInstant(this.now),
    });
    const durable = await boundedDependency(() =>
      controlCode === 'pause'
        ? this.store.pause(command)
        : controlCode === 'resume'
          ? this.store.resume(command)
          : this.store.deadLetter(command),
    );
    if (durable === undefined) {
      return invalid();
    }
    return requireEvidence(durable, command, controlCode);
  }
}
