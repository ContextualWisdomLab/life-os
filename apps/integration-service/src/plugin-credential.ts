import type {
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CREDENTIAL_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_SECRET_LENGTH = 8192;
const MAXIMUM_SECRET_REFERENCE_LENGTH = 512;

/** Generic fail-closed plugin-credential error without reflecting secret material. */
export class PluginCredentialError extends Error {
  /** Creates a fixed credential-free failure safe for an application boundary. */
  constructor() {
    super('Plugin credential request is invalid');
    this.name = 'PluginCredentialError';
  }
}

/** Narrow installation authority consumed by the credential boundary. */
export interface PluginInstallationAuthority {
  /** Returns one installation only inside trusted workspace-and-user authority. */
  getInstallation(
    trustedContext: PluginInstallationContext,
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined>;
}

/** Durable metadata for one secret-store-backed plugin credential binding. */
export interface PluginCredentialBindingRecord {
  readonly credentialBindingId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly installedByUserId: string;
  readonly credentialName: string;
  readonly secretReference: string;
  readonly status: 'active' | 'revoked';
  readonly boundAt: string;
  readonly revokedAt: string | null;
}

/** Public/application view that intentionally excludes the opaque secret reference. */
export type PluginCredentialBindingView = Omit<
  PluginCredentialBindingRecord,
  'secretReference'
>;

/** Atomic revocation request scoped to one installer-owned credential binding. */
export interface RevokePluginCredential {
  readonly credentialBindingId: string;
  readonly workspaceId: string;
  readonly installedByUserId: string;
  readonly revokedAt: string;
}

/** Durable host-owned metadata store; it never receives plaintext credential material. */
export interface PluginCredentialBindingStore {
  /** Reads one binding only inside authenticated workspace-and-user authority. */
  findById(
    credentialBindingId: string,
    workspaceId: string,
    installedByUserId: string,
  ): Promise<PluginCredentialBindingRecord | undefined>;
  /** Atomically creates a binding or returns the durable winner for that binding ID. */
  createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord>;
  /** Atomically revokes active authority or returns the exact durable revoked replay. */
  revokeActive(
    input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined>;
}

/** Secret material accepted only by the host-owned secret-store boundary. */
export interface PutPluginSecretInput {
  readonly credentialBindingId: string;
  readonly installationId: string;
  readonly workspaceId: string;
  readonly installedByUserId: string;
  readonly credentialName: string;
  readonly secretValue: string;
}

/**
 * External encrypted secret-store/KMS authority.
 *
 * `putSecret` must be idempotent for one credential binding identity and return an
 * opaque reference rather than plaintext. `deleteSecret` must tolerate exact
 * retries so a durable revocation can complete provider cleanup after an outage.
 */
export interface PluginSecretStore {
  putSecret(input: PutPluginSecretInput): Promise<string>;
  deleteSecret(secretReference: string): Promise<void>;
}

/** Input for one installer-authorized credential binding. Tenant/user authority is derived from trusted context. */
export interface BindPluginCredentialInput
  extends Omit<PutPluginSecretInput, 'workspaceId' | 'installedByUserId'> {
  readonly trustedContext: PluginInstallationContext;
}

function invalid(): never {
  throw new PluginCredentialError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

/**
 * Accepts only a UUIDv4 that is already stored in canonical lowercase form.
 * Persisted identity is evidence, so normalization is rejected rather than hidden.
 */
function requireStoredUuid(value: unknown): string {
  const canonical = requireUuidV4(value);
  if (value !== canonical) {
    return invalid();
  }
  return canonical;
}

/**
 * Bounds the trusted runtime context before field access and returns canonical
 * workspace/user UUIDv4 authority. Malformed envelopes fail without I/O.
 */
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

/** Rejects malformed bind command envelopes before secret or persistence authority is touched. */
function requireBindInput(value: unknown): BindPluginCredentialInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  return value as BindPluginCredentialInput;
}

/** Captures one canonical operation instant before any authority, persistence, or secret I/O. */
function currentInstant(now: () => Date): string {
  let value: unknown;
  try {
    value = now();
  } catch {
    return invalid();
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return invalid();
  }
  try {
    return value.toISOString();
  } catch {
    return invalid();
  }
}

/**
 * Requires persisted lifecycle time to be the canonical millisecond UTC instant
 * representation used by credential authority; equivalent alternate text is rejected.
 */
function requireStoredInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    return invalid();
  }
  return value;
}

/** Converts an already-validated canonical instant to epoch milliseconds for ordering only. */
function instantMilliseconds(value: string): number {
  return new Date(value).getTime();
}

function requireCredentialName(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_NAME_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

function requireSecretValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_SECRET_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function requireSecretReference(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > MAXIMUM_SECRET_REFERENCE_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    /\s/u.test(value)
  ) {
    return invalid();
  }
  return value;
}

/** Validates the complete durable binding lifecycle before any record becomes application authority. */
function requireBindingRecord(value: unknown): PluginCredentialBindingRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  const candidate = value as PluginCredentialBindingRecord;
  const status =
    candidate.status === 'active' || candidate.status === 'revoked'
      ? candidate.status
      : invalid();
  const boundAt = requireStoredInstant(candidate.boundAt);
  const revokedAt =
    candidate.revokedAt === null
      ? null
      : requireStoredInstant(candidate.revokedAt);
  if (
    (status === 'active' && revokedAt !== null) ||
    (status === 'revoked' && revokedAt === null) ||
    (revokedAt !== null &&
      instantMilliseconds(revokedAt) < instantMilliseconds(boundAt))
  ) {
    return invalid();
  }
  return Object.freeze({
    credentialBindingId: requireStoredUuid(candidate.credentialBindingId),
    installationId: requireStoredUuid(candidate.installationId),
    workspaceId: requireStoredUuid(candidate.workspaceId),
    installedByUserId: requireStoredUuid(candidate.installedByUserId),
    credentialName: requireCredentialName(candidate.credentialName),
    secretReference: requireSecretReference(candidate.secretReference),
    status,
    boundAt,
    revokedAt,
  });
}

function sameBindingAuthority(
  record: PluginCredentialBindingRecord,
  input: {
    readonly credentialBindingId: string;
    readonly installationId: string;
    readonly workspaceId: string;
    readonly installedByUserId: string;
    readonly credentialName: string;
  },
): boolean {
  return (
    record.credentialBindingId === input.credentialBindingId &&
    record.installationId === input.installationId &&
    record.workspaceId === input.workspaceId &&
    record.installedByUserId === input.installedByUserId &&
    record.credentialName === input.credentialName
  );
}

/**
 * Tests whether a validated durable binding can be observed at the captured
 * operation instant: binding must already exist and any revocation must not be future-dated.
 */
function bindingVisibleAt(
  record: PluginCredentialBindingRecord,
  operationAt: string,
): boolean {
  const operationMilliseconds = instantMilliseconds(operationAt);
  return (
    instantMilliseconds(record.boundAt) <= operationMilliseconds &&
    (record.revokedAt === null ||
      instantMilliseconds(record.revokedAt) <= operationMilliseconds)
  );
}

function activeBinding(
  record: PluginCredentialBindingRecord,
  input: Parameters<typeof sameBindingAuthority>[1],
): boolean {
  return (
    sameBindingAuthority(record, input) &&
    record.status === 'active' &&
    record.revokedAt === null &&
    requireSecretReference(record.secretReference) === record.secretReference
  );
}

function revokedBinding(
  record: PluginCredentialBindingRecord,
  input: {
    readonly credentialBindingId: string;
    readonly workspaceId: string;
    readonly installedByUserId: string;
  },
): boolean {
  return (
    record.credentialBindingId === input.credentialBindingId &&
    record.workspaceId === input.workspaceId &&
    record.installedByUserId === input.installedByUserId &&
    record.status === 'revoked' &&
    record.revokedAt !== null &&
    requireSecretReference(record.secretReference) === record.secretReference
  );
}

/**
 * Keeps a revoke winner tied to the exact immutable binding evidence that was
 * validated before the durable mutation. A store cannot redirect provider
 * deletion by changing installation, credential, secret reference, or bound time.
 */
function sameImmutableBindingEvidence(
  durable: PluginCredentialBindingRecord,
  existing: PluginCredentialBindingRecord,
): boolean {
  return (
    sameBindingAuthority(durable, existing) &&
    durable.secretReference === existing.secretReference &&
    durable.boundAt === existing.boundAt
  );
}

function view(
  record: PluginCredentialBindingRecord,
): PluginCredentialBindingView {
  return Object.freeze({
    credentialBindingId: record.credentialBindingId,
    installationId: record.installationId,
    workspaceId: record.workspaceId,
    installedByUserId: record.installedByUserId,
    credentialName: record.credentialName,
    status: record.status,
    boundAt: record.boundAt,
    revokedAt: record.revokedAt,
  });
}

/**
 * Binds plugin credentials to host-owned secret storage without persisting or
 * returning plaintext secret material.
 */
export class PluginCredentialApplication {
  constructor(
    private readonly installationAuthority: PluginInstallationAuthority,
    private readonly bindingStore: PluginCredentialBindingStore,
    private readonly secretStore: PluginSecretStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Stores new secret material only after exact active installation authority and
   * persists only the opaque reference returned by the external secret store.
   */
  async bind(input: BindPluginCredentialInput): Promise<PluginCredentialBindingView> {
    const request = requireBindInput(input);
    const context = requireContext(request.trustedContext);
    const installationId = requireUuidV4(request.installationId);
    const credentialBindingId = requireUuidV4(request.credentialBindingId);
    const credentialName = requireCredentialName(request.credentialName);
    const secretValue = requireSecretValue(request.secretValue);
    const boundAt = currentInstant(this.now);
    const installation = await this.installationAuthority.getInstallation(
      context,
      installationId,
    );
    if (
      !installation ||
      installation.status !== 'active' ||
      installation.revokedAt !== null ||
      installation.workspaceId !== context.workspaceId ||
      installation.installedByUserId !== context.actorUserId ||
      installation.installationId !== installationId
    ) {
      return invalid();
    }
    const installedAt = requireStoredInstant(installation.installedAt);
    if (instantMilliseconds(installedAt) > instantMilliseconds(boundAt)) {
      return invalid();
    }

    const authority = {
      credentialBindingId,
      installationId,
      workspaceId: context.workspaceId,
      installedByUserId: context.actorUserId,
      credentialName,
    } as const;
    const existingEvidence = await this.bindingStore.findById(
      credentialBindingId,
      context.workspaceId,
      context.actorUserId,
    );
    if (existingEvidence !== undefined) {
      const existing = requireBindingRecord(existingEvidence);
      if (
        !activeBinding(existing, authority) ||
        !bindingVisibleAt(existing, boundAt) ||
        instantMilliseconds(existing.boundAt) < instantMilliseconds(installedAt)
      ) {
        return invalid();
      }
      return view(existing);
    }

    let secretReference: string;
    try {
      secretReference = requireSecretReference(
        await this.secretStore.putSecret({
          credentialBindingId,
          installationId,
          workspaceId: context.workspaceId,
          installedByUserId: context.actorUserId,
          credentialName,
          secretValue,
        }),
      );
    } catch {
      return invalid();
    }

    const candidate: PluginCredentialBindingRecord = Object.freeze({
      ...authority,
      secretReference,
      status: 'active',
      boundAt,
      revokedAt: null,
    });
    let durable: PluginCredentialBindingRecord;
    try {
      durable = requireBindingRecord(
        await this.bindingStore.createIfAbsent(candidate),
      );
    } catch {
      try {
        await this.secretStore.deleteSecret(secretReference);
      } catch {
        // The operation remains failed closed. Provider-side orphan cleanup is an
        // operator concern until a durable compensation queue is introduced.
      }
      return invalid();
    }
    if (
      !activeBinding(durable, authority) ||
      !bindingVisibleAt(durable, boundAt) ||
      instantMilliseconds(durable.boundAt) < instantMilliseconds(installedAt)
    ) {
      try {
        await this.secretStore.deleteSecret(secretReference);
      } catch {
        // Do not turn a conflicting durable winner into application authority.
      }
      return invalid();
    }
    if (durable.secretReference !== secretReference) {
      try {
        await this.secretStore.deleteSecret(secretReference);
      } catch {
        return invalid();
      }
    }
    return view(durable);
  }

  /**
   * Revokes durable credential authority before idempotent external secret
   * deletion so a provider outage can be retried without restoring authority.
   */
  async revoke(
    trustedContext: PluginInstallationContext,
    credentialBindingIdInput: string,
  ): Promise<PluginCredentialBindingView> {
    const context = requireContext(trustedContext);
    const credentialBindingId = requireUuidV4(credentialBindingIdInput);
    const revokedAt = currentInstant(this.now);
    const existingEvidence = await this.bindingStore.findById(
      credentialBindingId,
      context.workspaceId,
      context.actorUserId,
    );
    if (existingEvidence === undefined) {
      return invalid();
    }
    const existing = requireBindingRecord(existingEvidence);
    if (
      existing.credentialBindingId !== credentialBindingId ||
      existing.workspaceId !== context.workspaceId ||
      existing.installedByUserId !== context.actorUserId ||
      !bindingVisibleAt(existing, revokedAt)
    ) {
      return invalid();
    }
    const durableEvidence = await this.bindingStore.revokeActive({
      credentialBindingId,
      workspaceId: context.workspaceId,
      installedByUserId: context.actorUserId,
      revokedAt,
    });
    if (durableEvidence === undefined) {
      return invalid();
    }
    const durable = requireBindingRecord(durableEvidence);
    if (
      !revokedBinding(durable, {
        credentialBindingId,
        workspaceId: context.workspaceId,
        installedByUserId: context.actorUserId,
      }) ||
      !sameImmutableBindingEvidence(durable, existing) ||
      (existing.status === 'revoked' &&
        durable.revokedAt !== existing.revokedAt) ||
      !bindingVisibleAt(durable, revokedAt)
    ) {
      return invalid();
    }
    try {
      await this.secretStore.deleteSecret(durable.secretReference);
    } catch {
      return invalid();
    }
    return view(durable);
  }
}
