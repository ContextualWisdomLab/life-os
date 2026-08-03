import { randomUUID } from 'node:crypto';
import {
  type PluginManifest,
  validatePluginManifest,
} from '@life-os/plugin-sdk';

const WORKSPACE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAXIMUM_PLUGINS_PER_WORKSPACE = 100;

/** Public tenant-scoped record returned for a registered plugin contract. */
export interface PluginInstallation {
  readonly plugin_installation_id: string;
  readonly workspace_id: string;
  readonly manifest: PluginManifest;
  readonly registered_at: string;
}

/** Stable domain error that never includes untrusted manifest values. */
export class PluginRegistryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PluginRegistryError';
  }
}

/** Requires an opaque UUIDv4 workspace boundary at the HTTP edge. */
export function requireWorkspaceId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !WORKSPACE_ID_PATTERN.test(value.toLowerCase())
  ) {
    throw new PluginRegistryError('workspace_id_invalid');
  }
  return value.toLowerCase();
}

/** Tenant-safe registry abstraction for versioned plugin contracts. */
export interface PluginRegistry {
  register(workspaceId: string, manifest: unknown): PluginInstallation;
  list(workspaceId: string): readonly PluginInstallation[];
}

/**
 * In-memory contract registry for the first integration slice.
 *
 * The abstraction intentionally permits a durable repository replacement without
 * changing the versioned HTTP or SDK contract.
 */
export class InMemoryPluginRegistry implements PluginRegistry {
  private readonly installationsByWorkspace = new Map<
    string,
    Map<string, PluginInstallation>
  >();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Registers one validated plugin identifier per workspace. */
  register(workspaceId: string, input: unknown): PluginInstallation {
    const validatedWorkspaceId = requireWorkspaceId(workspaceId);
    const manifest = validatePluginManifest(input);
    const workspaceInstallations =
      this.installationsByWorkspace.get(validatedWorkspaceId) ?? new Map();

    if (workspaceInstallations.has(manifest.plugin_id)) {
      throw new PluginRegistryError('plugin_already_registered');
    }
    if (workspaceInstallations.size >= MAXIMUM_PLUGINS_PER_WORKSPACE) {
      throw new PluginRegistryError('plugin_registry_capacity_reached');
    }

    const installation = Object.freeze({
      plugin_installation_id: randomUUID(),
      workspace_id: validatedWorkspaceId,
      manifest,
      registered_at: this.now().toISOString(),
    });
    workspaceInstallations.set(manifest.plugin_id, installation);
    this.installationsByWorkspace.set(
      validatedWorkspaceId,
      workspaceInstallations,
    );
    return installation;
  }

  /** Lists only the current workspace's plugin contracts in stable order. */
  list(workspaceId: string): readonly PluginInstallation[] {
    const validatedWorkspaceId = requireWorkspaceId(workspaceId);
    return Object.freeze(
      [
        ...(this.installationsByWorkspace.get(validatedWorkspaceId)?.values() ??
          []),
      ]
        .sort((left, right) =>
          left.manifest.plugin_id.localeCompare(right.manifest.plugin_id),
        )
        .map((installation) => installation),
    );
  }
}
