import { describe, expect, it, vi } from 'vitest';
import {
  createPluginVaultHostedRuntime,
  PluginVaultHostedRuntimeError,
  type PluginHostedPostgresPool,
  type PluginHostedPostgresPoolFactory,
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

async function expectRuntimeFailure(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toEqual(
    expect.objectContaining({
      name: 'PluginVaultHostedRuntimeError',
      message: 'Plugin hosted runtime configuration is unavailable',
    }),
  );
}

describe('Plugin Vault hosted runtime', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['oversized', 'x'.repeat(8_193)],
  ])(
    'rejects %s Integration-owned PostgreSQL configuration before creating a pool',
    async (_label, databaseUrl) => {
      const createPool = vi.fn(() => pool());

      await expectRuntimeFailure(
        createPluginVaultHostedRuntime(
          createPool,
          environment({ INTEGRATION_DATABASE_URL: databaseUrl }),
        ),
      );
      expect(createPool).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined, 'invalid', []])(
    'bounds malformed environment envelope %j before configuration field access',
    async (malformed) => {
      const createPool = vi.fn(() => pool());

      await expectRuntimeFailure(
        createPluginVaultHostedRuntime(
          createPool,
          malformed as unknown as Readonly<Record<string, string | undefined>>,
        ),
      );
      expect(createPool).not.toHaveBeenCalled();
    },
  );

  it('bounds a throwing database configuration accessor before pool acquisition', async () => {
    const createPool = vi.fn(() => pool());
    const env = Object.create(null) as Record<string, string | undefined>;
    Object.defineProperty(env, 'INTEGRATION_DATABASE_URL', {
      enumerable: true,
      get() {
        throw new Error('database accessor fixture secret');
      },
    });

    await expectRuntimeFailure(createPluginVaultHostedRuntime(createPool, env));
    expect(createPool).not.toHaveBeenCalled();
  });

  it('rejects a malformed pool factory before resource acquisition', async () => {
    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(
        null as unknown as PluginHostedPostgresPoolFactory,
        environment(),
      ),
    );
  });

  it('bounds pool-factory rejection without reflecting dependency detail', async () => {
    const createPool = vi.fn(async () => {
      throw new Error('database credential fixture must never escape');
    });

    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(createPool, environment()),
    );
    expect(createPool).toHaveBeenCalledTimes(1);
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

  it('shares one bounded shutdown failure without retrying pool end', async () => {
    const ownedPool = pool();
    ownedPool.end.mockRejectedValueOnce(new Error('pool shutdown fixture'));
    const runtime = await createPluginVaultHostedRuntime(
      () => ownedPool,
      environment(),
    );

    const first = runtime.close();
    const second = runtime.close();
    await expectRuntimeFailure(first);
    await expectRuntimeFailure(second);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('closes an acquired pool when Vault/operator composition fails before listener registration', async () => {
    const ownedPool = pool();
    const createPool = vi.fn(() => ownedPool);

    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(
        createPool,
        environment({ INTEGRATION_PLUGIN_VAULT_MOUNT: undefined }),
      ),
    );
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('keeps composition failure credential-free when cleanup also fails', async () => {
    const ownedPool = pool();
    ownedPool.end.mockRejectedValueOnce(new Error('cleanup fixture secret'));

    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(
        () => ownedPool,
        environment({ INTEGRATION_PLUGIN_VAULT_MOUNT: undefined }),
      ),
    );
    expect(ownedPool.end).toHaveBeenCalledTimes(1);
  });

  it('closes an acquired pool-like resource when its SQL authority is malformed', async () => {
    const end = vi.fn(async () => undefined);
    const malformed = { end } as unknown as PluginHostedPostgresPool;
    const createPool = vi.fn(() => malformed);

    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(createPool, environment()),
    );
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('still returns the bounded failure when malformed acquired-resource cleanup rejects', async () => {
    const end = vi.fn(async () => {
      throw new Error('malformed cleanup fixture');
    });
    const malformed = { end } as unknown as PluginHostedPostgresPool;

    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(() => malformed, environment()),
    );
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('bounds a throwing cleanup accessor on malformed acquired SQL authority', async () => {
    const malformed = {
      query: vi.fn(),
      get end(): never {
        throw new Error('pool accessor fixture secret');
      },
    } as unknown as PluginHostedPostgresPool;

    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(() => malformed, environment()),
    );
  });

  it.each([
    null,
    undefined,
    {},
    { query: vi.fn() },
    { end: vi.fn() },
  ])('rejects malformed acquired SQL authority %j', async (malformed) => {
    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(
        () => malformed as unknown as PluginHostedPostgresPool,
        environment(),
      ),
    );
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

    await expectRuntimeFailure(
      createPluginVaultHostedRuntime(createPool, env),
    );
    expect(createPool).not.toHaveBeenCalled();
  });
});
