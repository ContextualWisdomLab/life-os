import { describe, expect, it, vi } from 'vitest';
import type { PutPluginSecretInput } from './plugin-credential';
import {
  PluginVaultSecretStore,
  PluginVaultSecretStoreError,
  type PluginVaultHttpClient,
  type PluginVaultHttpResponse,
} from './plugin-vault-secret-store';

const BINDING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTALLATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WORKSPACE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TOKEN = 'test-vault-token-not-a-real-credential';

const INPUT: PutPluginSecretInput = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'webhook.signing',
  secretValue: 'buyer secret value',
});

function response(status: number): PluginVaultHttpResponse {
  return {
    status,
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
  };
}

describe('PluginVaultSecretStore response cleanup', () => {
  it('cancels a declared-oversized replay body before failing closed', async () => {
    let cancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => '70000' },
        body: oversizedBody,
      });
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    await expect(store.putSecret(INPUT)).rejects.toBeInstanceOf(
      PluginVaultSecretStoreError,
    );
    expect(cancelled).toBe(true);
  });
});
