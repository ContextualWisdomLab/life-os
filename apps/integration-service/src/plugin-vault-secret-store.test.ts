import { describe, expect, it, vi } from 'vitest';
import type { PutPluginSecretInput } from './plugin-credential';
import {
  PluginVaultSecretStore,
  PluginVaultSecretStoreError,
  type PluginVaultHttpClient,
  type PluginVaultHttpResponse,
} from './plugin-vault-secret-store';

const BINDING_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const TOKEN = `hvs.${'a'.repeat(48)}`;
const REFERENCE = `lifeos-plugin-vault://${BINDING_ID}`;

const INPUT: PutPluginSecretInput = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'webhook.signing',
  secretValue: 'buyer-secret-value',
});

function response(status: number, body = ''): PluginVaultHttpResponse {
  return {
    status,
    headers: { get: () => null },
    text: async () => body,
  };
}

function exactVaultRead(secretValue = INPUT.secretValue): string {
  return JSON.stringify({
    data: {
      data: {
        schemaVersion: 1,
        credentialBindingId: BINDING_ID,
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        credentialName: INPUT.credentialName,
        secretValue,
      },
    },
  });
}

describe('PluginVaultSecretStore', () => {
  it('creates one binding with Vault KV v2 CAS=0 and returns only an opaque binding reference', async () => {
    const http = vi.fn<PluginVaultHttpClient>().mockResolvedValue(response(200));
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    await expect(store.putSecret(INPUT)).resolves.toBe(REFERENCE);

    expect(http).toHaveBeenCalledTimes(1);
    const [url, request] = http.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://vault.example.test/v1/secret/data/life-os/plugin-credentials/${BINDING_ID}`,
    );
    expect(request?.method).toBe('POST');
    expect(request?.redirect).toBe('error');
    expect(request?.headers['x-vault-token']).toBe(TOKEN);
    expect(JSON.parse(request?.body ?? '{}')).toEqual({
      options: { cas: 0 },
      data: {
        schemaVersion: 1,
        credentialBindingId: BINDING_ID,
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        credentialName: 'webhook.signing',
        secretValue: 'buyer-secret-value',
      },
    });
  });

  it('recovers an ambiguous create response only when the exact durable Vault winner matches', async () => {
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400, '{"errors":["check-and-set parameter did not match"]}'))
      .mockResolvedValueOnce(response(200, exactVaultRead()));
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    await expect(store.putSecret(INPUT)).resolves.toBe(REFERENCE);
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[1]?.[1].method).toBe('GET');
  });

  it('fails closed when another durable secret wins the same binding identity', async () => {
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce(response(200, exactVaultRead('different-secret-value')));
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    await expect(store.putSecret(INPUT)).rejects.toBeInstanceOf(
      PluginVaultSecretStoreError,
    );
  });

  it('treats exact missing metadata as idempotent deletion without exposing Vault details', async () => {
    const http = vi.fn<PluginVaultHttpClient>().mockResolvedValue(response(404));
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    await expect(store.deleteSecret(REFERENCE)).resolves.toBeUndefined();
    expect(http.mock.calls[0]?.[0]).toBe(
      `https://vault.example.test/v1/secret/metadata/life-os/plugin-credentials/${BINDING_ID}`,
    );
    expect(http.mock.calls[0]?.[1].method).toBe('DELETE');
  });

  it('rejects non-HTTPS configuration and malformed secret references before network I/O', async () => {
    expect(
      () => new PluginVaultSecretStore('http://vault.example.test', TOKEN),
    ).toThrow(PluginVaultSecretStoreError);

    const http = vi.fn<PluginVaultHttpClient>();
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    await expect(store.deleteSecret('lifeos-plugin-vault://not-a-uuid')).rejects.toBeInstanceOf(
      PluginVaultSecretStoreError,
    );
    expect(http).not.toHaveBeenCalled();
  });

  it('rejects malformed or oversized Vault read evidence instead of accepting replay authority', async () => {
    const malformed = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce(response(200, '{"data":{"data":null}}'));
    const malformedStore = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      malformed,
    );
    await expect(malformedStore.putSecret(INPUT)).rejects.toBeInstanceOf(
      PluginVaultSecretStoreError,
    );

    const oversized = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce(response(200, 'x'.repeat(70_000)));
    const oversizedStore = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      oversized,
    );
    await expect(oversizedStore.putSecret(INPUT)).rejects.toBeInstanceOf(
      PluginVaultSecretStoreError,
    );
  });
});
