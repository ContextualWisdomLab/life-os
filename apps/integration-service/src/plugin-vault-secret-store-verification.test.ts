import { describe, expect, it } from 'vitest';
import {
  PluginVaultSecretStore,
  PluginVaultSecretStoreError,
  type PluginVaultHttpResponse,
} from './plugin-vault-secret-store';
import type { PutPluginSecretInput } from './plugin-credential';

const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const INPUT: PutPluginSecretInput = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  installedByUserId: '33333333-3333-4333-8333-333333333333',
  credentialName: 'webhook.signing',
  secretValue: 'original-plugin-secret-value',
});
const REFERENCE = `lifeos-plugin-vault://${BINDING_ID}`;

function vaultEnvelope(secretValue = INPUT.secretValue): object {
  return {
    data: {
      data: {
        schemaVersion: 1,
        credentialBindingId: INPUT.credentialBindingId,
        installationId: INPUT.installationId,
        workspaceId: INPUT.workspaceId,
        installedByUserId: INPUT.installedByUserId,
        credentialName: INPUT.credentialName,
        secretValue,
      },
    },
  };
}

function response(status: number, body?: object): PluginVaultHttpResponse {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Response(encoded, {
    status,
    ...(encoded === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' } }),
  });
}

describe('PluginVaultSecretStore replay verification', () => {
  it('accepts only exact durable Vault authority and secret bytes', async () => {
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      'vault-token-that-is-long-enough',
      'secret',
      async (_url, request) => {
        expect(request.method).toBe('GET');
        return response(200, vaultEnvelope());
      },
    );
    await expect(store.verifySecret(REFERENCE, INPUT)).resolves.toBeUndefined();
  });

  it('rejects conflicting or missing provider evidence without recreating it', async () => {
    const conflicting = new PluginVaultSecretStore(
      'https://vault.example.test',
      'vault-token-that-is-long-enough',
      'secret',
      async () => response(200, vaultEnvelope('different-provider-secret')),
    );
    await expect(conflicting.verifySecret(REFERENCE, INPUT)).rejects.toBeInstanceOf(
      PluginVaultSecretStoreError,
    );

    const missing = new PluginVaultSecretStore(
      'https://vault.example.test',
      'vault-token-that-is-long-enough',
      'secret',
      async () => response(404),
    );
    await expect(missing.verifySecret(REFERENCE, INPUT)).rejects.toBeInstanceOf(
      PluginVaultSecretStoreError,
    );
  });
});
