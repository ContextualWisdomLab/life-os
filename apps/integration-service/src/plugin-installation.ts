import type { PluginManifest } from '@life-os/plugin-sdk';

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

/** Persistence port implemented by the LifeOS host, never by a plugin. */
export interface PluginInstallationStore {
  findById(installationId: string): Promise<PluginInstallationRecord | undefined>;
  save(record: PluginInstallationRecord): Promise<void>;
}

/** Input for one idempotent, explicitly granted plugin installation. */
export interface InstallPluginInput {
  readonly trustedContext: PluginInstallationContext;
  readonly installationId: string;
  readonly manifest: PluginManifest;
  readonly grantedCapabilities: readonly string[];
}

/**
 * Owns plugin installation and revocation authority independently of plugin code.
 *
 * The first test-first slice intentionally exposes the stable host/store contract
 * before the implementation is filled in; callers must treat failures as closed.
 */
export class PluginInstallationApplication {
  constructor(
    private readonly store: PluginInstallationStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    void this.store;
    void this.now;
  }

  async install(_input: InstallPluginInput): Promise<PluginInstallationRecord> {
    throw new PluginInstallationError();
  }

  async getInstallation(
    _trustedContext: PluginInstallationContext,
    _installationId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    throw new PluginInstallationError();
  }

  async revoke(
    _trustedContext: PluginInstallationContext,
    _installationId: string,
  ): Promise<PluginInstallationRecord> {
    throw new PluginInstallationError();
  }
}
