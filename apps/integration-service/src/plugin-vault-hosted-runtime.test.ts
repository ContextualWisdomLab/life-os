import { describe, expect, it, vi } from 'vitest';
import {
  createPluginVaultHostedRuntime,
  PluginVaultHostedRuntimeError,
  type PluginHostedPostgresPool,
} from './plugin-vault-hosted-runtime';

const DATABASE_URL = 'postgresql://runtime.invalid/life_os';
const CONTEXT_SECRET = 'operator-context-fixture-value-32-bytes-minimum';

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    INTEGRATION_DATABASE_URL: DATABASE_URL,
    INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
    INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
    INTEGRATION_PLUGIN_VAULT_TOKEN: 'vault-fixture-token-value',
    INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
    ...overrides,
  });
}

function pool(): PluginHostedPostgresPool & {
  readonly query: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
} {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    end: vi.fn(async () => undefined),
  };
}

describe('Plugin Vault hosted runtime', () => {
  it('requires the Integration-owned PostgreSQL configuration before creating a pool', async () => {
    const createPool = vi.fn(() => pool());

    await expect(
      createPluginVaultHostedRuntime(
        createPool,
        environment({ INTEGRATION_DATABASE_URL: undefined }),
      ),
    ).rejects.toBeInstanceOf(PluginVaultHostedRuntimeError);
    expect(createPool).not.toHaveBeenCalled();
  });

  it('constructs one service-owned pool and closes it exactly once across repeated shutdown', async () => {
    const ownedPool = pool();
    const createPool = vi.fn(() => ownedPool);

    const runtime = await createPluginVaultHostedRuntime(
      createPool,
      environment(),
    );

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith(DATABASE_URL);
    expect(runtime.operator).toBeDefined();

    await Promise.all([runtime.close(), runtime.close(), runtime.close()]);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('closes an acquired pool when Vault/operator composition fails before listener registration', async () => {
    const ownedPool = pool();
    const createPool = vi.fn(() => ownedPool);

    await expect(
      createPluginVaultHostedRuntime(
        createPool,
        environment({ INTEGRATION_PLUGIN_VAULT_MOUNT: undefined }),
      ),
    ).rejects.toBeInstanceOf(PluginVaultHostedRuntimeError);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('rejects generic database aliases instead of accepting cross-service persistence authority', async () => {
    const createPool = vi.fn(() => pool());
    const env = Object.freeze({
      DATABASE_URL,
      INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
      INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
      INTEGRATION_PLUGIN_VAULT_TOKEN: 'vault-fixture-token-value',
      INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
    });

    await expect(
      createPluginVaultHostedRuntime(createPool, env),
    ).rejects.toBeInstanceOf(PluginVaultHostedRuntimeError);
    expect(createPool).not.toHaveBeenCalled();
  });
});
