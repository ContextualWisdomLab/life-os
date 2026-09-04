import { describe, expect, it, vi } from 'vitest';
import type { PluginCredentialBindingStore } from './plugin-credential';
import type { PluginInstallationOperatorPort } from './plugin-operator-application';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import {
  createPluginVaultOperatorApplication,
  PluginVaultOperatorCompositionError,
} from './plugin-vault-operator-composition';

const CONTEXT_SECRET = 'integration-operator-context-secret-fixture';
const VAULT_TOKEN = 'integration-vault-token-fixture';

function dependencies(): Readonly<{
  installations: PluginInstallationOperatorPort;
  bindingStore: PluginCredentialBindingStore;
  replayGuard: PluginOperatorReplayGuardPort;
}> {
  return Object.freeze({
    installations: {
      install: vi.fn(),
      getInstallation: vi.fn(),
      revoke: vi.fn(),
    },
    bindingStore: {
      findById: vi.fn(),
      createIfAbsent: vi.fn(),
      revokeActive: vi.fn(),
    },
    replayGuard: {
      consume: vi.fn(),
    },
  });
}

describe('Plugin Vault operator configuration ownership', () => {
  it('accepts only Integration-owned Vault configuration names', () => {
    expect(() =>
      createPluginVaultOperatorApplication(dependencies(), {
        INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
        INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
        INTEGRATION_PLUGIN_VAULT_TOKEN: VAULT_TOKEN,
        INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
      }),
    ).not.toThrow();
  });

  it('does not treat generic Vault aliases as service-owned credential authority', () => {
    expect(() =>
      createPluginVaultOperatorApplication(dependencies(), {
        INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
        PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
        PLUGIN_VAULT_TOKEN: VAULT_TOKEN,
        PLUGIN_VAULT_MOUNT: 'secret',
      }),
    ).toThrow(PluginVaultOperatorCompositionError);
  });
});
