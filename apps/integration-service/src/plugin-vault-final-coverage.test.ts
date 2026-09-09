import { afterEach, describe, expect, it, vi } from 'vitest';
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
const encoder = new TextEncoder();

const INPUT: PutPluginSecretInput = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'provider.access',
  secretValue: 'buyer secret value',
});

function response(status: number, body = ''): PluginVaultHttpResponse {
  return {
    status,
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        if (body.length > 0) controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
  };
}

function store(http: PluginVaultHttpClient): PluginVaultSecretStore {
  return new PluginVaultSecretStore(
    'https://vault.example.test',
    TOKEN,
    'secret',
    http,
  );
}

async function expectUnavailable(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(PluginVaultSecretStoreError);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PluginVaultSecretStore final coverage boundaries', () => {
  it('fails closed when create reconciliation returns malformed JSON', async () => {
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce(response(200, '{'));

    await expectUnavailable(store(http).putSecret(INPUT));
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('fails closed when create reconciliation cannot read a durable winner', async () => {
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(409))
      .mockResolvedValueOnce(response(404));

    await expectUnavailable(store(http).putSecret(INPUT));
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('rejects a transport result that resolves as its request deadline expires', async () => {
    class DeadlineRaceController {
      readonly signal: AbortSignal;

      constructor() {
        const target = new EventTarget();
        let reads = 0;
        Object.defineProperty(target, 'aborted', {
          configurable: true,
          get: () => {
            reads += 1;
            return reads > 1;
          },
        });
        this.signal = target as AbortSignal;
      }

      abort(): void {}
    }

    vi.stubGlobal('AbortController', DeadlineRaceController);
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValue(response(204));

    await expectUnavailable(store(http).deleteSecret(REFERENCE));
    expect(http).toHaveBeenCalledTimes(1);
  });
});
