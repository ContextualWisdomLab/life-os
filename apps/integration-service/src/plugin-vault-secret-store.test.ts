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
const encoder = new TextEncoder();

const INPUT: PutPluginSecretInput = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'webhook.signing',
  secretValue: 'buyer secret value',
});

function streamFromText(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

function response(status: number, body = ''): PluginVaultHttpResponse {
  return {
    status,
    headers: { get: () => null },
    body: streamFromText(body),
  };
}

function exactVaultRead(
  secretValue = INPUT.secretValue,
  credentialBindingId = BINDING_ID,
): string {
  return JSON.stringify({
    data: {
      data: {
        schemaVersion: 1,
        credentialBindingId,
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
        secretValue: 'buyer secret value',
      },
    });
  });

  it('rejects non-canonical caller authority identities before Vault I/O', async () => {
    const authorityFields: ReadonlyArray<keyof Pick<
      PutPluginSecretInput,
      'credentialBindingId' | 'installationId' | 'workspaceId' | 'installedByUserId'
    >> = [
      'credentialBindingId',
      'installationId',
      'workspaceId',
      'installedByUserId',
    ];

    for (const field of authorityFields) {
      const http = vi.fn<PluginVaultHttpClient>().mockResolvedValue(response(200));
      const store = new PluginVaultSecretStore(
        'https://vault.example.test',
        TOKEN,
        'secret',
        http,
      );
      const input = {
        ...INPUT,
        [field]: INPUT[field].toUpperCase(),
      } as PutPluginSecretInput;

      await expect(store.putSecret(input)).rejects.toBeInstanceOf(
        PluginVaultSecretStoreError,
      );
      expect(http).not.toHaveBeenCalled();
    }
  });

  it('recovers an ambiguous create response only when the exact durable Vault winner matches', async () => {
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
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

  it('keeps the total request deadline active while replay response bytes are consumed', async () => {
    vi.useFakeTimers();
    let replaySignal: AbortSignal | undefined;
    const stalledBody = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
    });
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockImplementationOnce(async (_url, request) => {
        replaySignal = request.signal;
        return {
          status: 200,
          headers: { get: () => null },
          body: stalledBody,
        };
      });
    const store = new PluginVaultSecretStore(
      'https://vault.example.test',
      TOKEN,
      'secret',
      http,
    );

    try {
      let rejected = false;
      const settled = store.putSecret(INPUT).catch(() => {
        rejected = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(replaySignal).toBeDefined();

      await vi.advanceTimersByTimeAsync(5_001);
      await settled;

      expect(replaySignal?.aborted).toBe(true);
      expect(rejected).toBe(true);
      expect(http).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops an undeclared-length replay body as soon as the byte limit is exceeded', async () => {
    let cancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32_768));
        controller.enqueue(new Uint8Array(32_769));
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
        headers: { get: () => null },
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

  it('zeroizes replay bytes already read when the Vault stream fails', async () => {
    const sensitiveChunk = encoder.encode('partial buyer secret value');
    let readCount = 0;
    const failingBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (readCount === 0) {
          readCount += 1;
          controller.enqueue(sensitiveChunk);
          return;
        }
        controller.error(new Error('stream failure detail must not escape'));
      },
    });
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        body: failingBody,
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
    expect([...sensitiveChunk]).toEqual(new Array(sensitiveChunk.length).fill(0));
  });

  it('fails closed when another durable secret wins the same binding identity', async () => {
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce(response(200, exactVaultRead('different secret value')));
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

  it('rejects non-canonical persisted binding identity instead of normalizing Vault evidence', async () => {
    const http = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce(
        response(200, exactVaultRead(INPUT.secretValue, BINDING_ID.toUpperCase())),
      );
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

    await expect(
      store.deleteSecret('lifeos-plugin-vault://not-a-uuid'),
    ).rejects.toBeInstanceOf(PluginVaultSecretStoreError);
    expect(http).not.toHaveBeenCalled();
  });

  it('rejects malformed or oversized declared Vault read evidence instead of accepting replay authority', async () => {
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
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => '70000' },
        body: streamFromText(''),
      });
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
