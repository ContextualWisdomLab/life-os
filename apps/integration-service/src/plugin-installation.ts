import { createHash } from 'node:crypto';
import {
  serializeCanonicalJson,
  validatePluginManifest,
  type PluginManifest,
} from '@life-os/plugin-sdk';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAXIMUM_GRANTED_CAPABILITIES = 32;

/** Generic fail-closed installation authority failure without untrusted reflection. */
export class PluginInstallationError extends Error {
  constructor() {
    super('Plugin installation request is invalid');
    this.name = 'PluginInstallationError';
  }
}

/** Trusted tenant/user context supplied by the authenticated host boundary. */
export interface PluginInstallationContext {
  readonly workspaceId: string;
  readonly actorUserId: string;
}

/** Durable host-owned installation record; plugin manifests are never authority. */
export interface PluginInstallationRecord {
  readonly installationId: string;
  readonly workspaceId: string;
  readonly installedByUserId: string;
  readonly pluginId: string;
  readonly pluginContractVersion: string;
  readonly manifestSha256: string;
  readonly grantedCapabilities: readonly string[];
  readonly status: 'active' | 'revoked';
  readonly installedAt: string;
  readonly revokedAt: string | null;
}

/**
 * Atomic revocation request owned by the host persistence boundary.
 *
 * `installedByUserId` is derived from authenticated host context and remains part
 * of the durable lookup/update scope; plugin input never supplies this authority.
 */
export interface RevokePluginInstallation {
  readonly installationId: string;
  readonly workspaceId: string;
  readonly installedByUserId: string;
  readonly revokedAt: string;
}

/** Persistence port implemented by the LifeOS host, never by a plugin. */
export interface PluginInstallationStore {
  /**
   * Atomically creates an installation when its opaque identity is absent and
   * returns the durable winner when another request already owns that identity.
   *
   * Durable implementations must bind this operation to a unique installation
   * identity or equivalent compare-and-set primitive; a read-then-write sequence
   * is not sufficient because concurrent conflicting grants must fail closed.
   */
  createIfAbsent(record: PluginInstallationRecord): Promise<PluginInstallationRecord>;
  /** Reads one installation only inside the authenticated workspace-and-user scope. */
  findById(
    installationId: string,
    workspaceId: string,
    installedByUserId: string,
  ): Promise<PluginInstallationRecord | undefined>;
  /**
   * Atomically transitions one active workspace-and-user-owned installation to
   * revoked, returning the already-revoked durable winner for an exact replay.
   *
   * Durable implementations must scope the update by installation, workspace,
   * installing user and lifecycle state so another member of the same workspace
   * cannot read or revoke authority they do not own.
   */
  revokeActive(input: RevokePluginInstallation): Promise<PluginInstallationRecord | undefined>;
}

/** Input for one idempotent, explicitly granted plugin installation. */
export interface InstallPluginInput {
  readonly trustedContext: PluginInstallationContext;
  readonly installationId: string;
  readonly manifest: PluginManifest;
  readonly grantedCapabilities: readonly string[];
}

function invalid(): never {
  throw new PluginInstallationError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

function requireContext(input: PluginInstallationContext): PluginInstallationContext {
  return Object.freeze({
    workspaceId: requireUuidV4(input.workspaceId),
    actorUserId: requireUuidV4(input.actorUserId),
  });
}

function requireManifest(input: PluginManifest): PluginManifest {
  try {
    return validatePluginManifest(input);
  } catch {
    return invalid();
  }
}

function requireGrantedCapabilities(
  manifest: PluginManifest,
  input: readonly string[],
): readonly string[] {
  if (
    !Array.isArray(input) ||
    input.length > MAXIMUM_GRANTED_CAPABILITIES ||
    input.some(
      (capability) =>
        typeof capability !== 'string' ||
        !manifest.subscriptions.includes(capability),
    )
  ) {
    return invalid();
  }
  const unique = new Set(input);
  if (unique.size !== input.length) {
    return invalid();
  }
  return Object.freeze([...unique].sort());
}

function manifestDigest(manifest: PluginManifest): string {
  return createHash('sha256')
    .update(serializeCanonicalJson(manifest))
    .digest('hex');
}

function freezeRecord(record: PluginInstallationRecord): PluginInstallationRecord {
  return Object.freeze({
    ...record,
    grantedCapabilities: Object.freeze([...record.grantedCapabilities]),
  });
}

function sameInstallation(
  existing: PluginInstallationRecord,
  candidate: PluginInstallationRecord,
): boolean {
  return (
    existing.installationId === candidate.installationId &&
    existing.workspaceId === candidate.workspaceId &&
    existing.installedByUserId === candidate.installedByUserId &&
    existing.pluginId === candidate.pluginId &&
    existing.pluginContractVersion === candidate.pluginContractVersion &&
    existing.manifestSha256 === candidate.manifestSha256 &&
    existing.status === 'active' &&
    existing.grantedCapabilities.length === candidate.grantedCapabilities.length &&
    existing.grantedCapabilities.every(
      (value, index) => value === candidate.grantedCapabilities[index],
    )
  );
}

/**
 * Owns plugin installation and revocation authority independently of plugin code.
 *
 * The application treats a validated manifest as requested capability intent only.
 * LifeOS persists the smaller host-approved grant set and never lets plugin input
 * widen its own tenant or installer-user authority.
 */
export class PluginInstallationApplication {
  constructor(
    private readonly store: PluginInstallationStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Installs an explicitly granted manifest or returns its exact idempotent replay. */
  async install(input: InstallPluginInput): Promise<PluginInstallationRecord> {
    const context = requireContext(input.trustedContext);
    const installationId = requireUuidV4(input.installationId);
    const manifest = requireManifest(input.manifest);
    const grantedCapabilities = requireGrantedCapabilities(
      manifest,
      input.grantedCapabilities,
    );
    const candidate = freezeRecord({
      installationId,
      workspaceId: context.workspaceId,
      installedByUserId: context.actorUserId,
      pluginId: manifest.pluginId,
      pluginContractVersion: manifest.contractVersion,
      manifestSha256: manifestDigest(manifest),
      grantedCapabilities,
      status: 'active',
      installedAt: this.now().toISOString(),
      revokedAt: null,
    });
    const durable = await this.store.createIfAbsent(candidate);
    if (!sameInstallation(durable, candidate)) {
      return invalid();
    }
    return freezeRecord(durable);
  }

  /** Returns an installation only inside authenticated workspace-and-user authority. */
  async getInstallation(
    trustedContext: PluginInstallationContext,
    installationIdInput: string,
  ): Promise<PluginInstallationRecord | undefined> {
    const context = requireContext(trustedContext);
    const installationId = requireUuidV4(installationIdInput);
    const existing = await this.store.findById(
      installationId,
      context.workspaceId,
      context.actorUserId,
    );
    if (
      !existing ||
      existing.workspaceId !== context.workspaceId ||
      existing.installedByUserId !== context.actorUserId
    ) {
      return undefined;
    }
    return freezeRecord(existing);
  }

  /** Revokes future use while preserving one immutable durable lifecycle transition. */
  async revoke(
    trustedContext: PluginInstallationContext,
    installationIdInput: string,
  ): Promise<PluginInstallationRecord> {
    const context = requireContext(trustedContext);
    const installationId = requireUuidV4(installationIdInput);
    const durable = await this.store.revokeActive({
      installationId,
      workspaceId: context.workspaceId,
      installedByUserId: context.actorUserId,
      revokedAt: this.now().toISOString(),
    });
    if (
      !durable ||
      durable.installationId !== installationId ||
      durable.workspaceId !== context.workspaceId ||
      durable.installedByUserId !== context.actorUserId ||
      durable.status !== 'revoked' ||
      durable.revokedAt === null
    ) {
      return invalid();
    }
    return freezeRecord(durable);
  }
}
