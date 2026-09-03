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
const REFERENCE = `lifeos-plugin-vault://${BINDING_ID}`;

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

function cancellableResponse(
  status: number,
  onCancel: () => void,
): PluginVaultHttpResponse {
  return {
    status,
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        onCancel();
      },
    }),
  };
}

describe('PluginVaultSecretStore response cleanup', () => {
  it('cancels status-only create and delete bodies before accepting their status', async () => {
    let createCancelled = false;
    let deleteCancelled = false;
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(
        cancellableResponse(200, () => {
          createCancelled = true;
        }),
      )
      .mockResolvedValueOnce(
        cancellableResponse(404, () => {
          deleteCancelled = true;
        }),
      );
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    await expect(store.putSecret(INPUT)).resolves.toBe(REFERENCE);
    await expect(store.deleteSecret(REFERENCE)).resolves.toBeUndefined();
    expect(createCancelled).toBe(true);
    expect(deleteCancelled).toBe(true);
  });

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
