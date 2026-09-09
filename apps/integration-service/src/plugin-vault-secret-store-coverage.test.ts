import { describe, expect, it, vi } from 'vitest';
import type { PutPluginSecretInput } from './plugin-credential';
import {
  PluginVaultSecretStore,
  PluginVaultSecretStoreError,
  type PluginVaultHttpClient,
  type PluginVaultHttpResponse,
} from './plugin-vault-secret-store';

const BINDING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_BINDING_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
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

function vaultRead(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    data: {
      data: {
        schemaVersion: 1,
        credentialBindingId: BINDING_ID,
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        credentialName: INPUT.credentialName,
        secretValue: INPUT.secretValue,
        ...overrides,
      },
    },
  });
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

describe('PluginVaultSecretStore hostile boundary coverage', () => {
  it('rejects malformed payload, operator configuration, and opaque references before provider authority', async () => {
    const http = vi.fn<PluginVaultHttpClient>();
    const secretStore = store(http);

    for (const input of [
      null,
      [],
      { ...INPUT, credentialName: 'Bad Name' },
      { ...INPUT, secretValue: '' },
      { ...INPUT, secretValue: 'buyer\nsecret' },
      { ...INPUT, secretValue: 'x'.repeat(8_193) },
    ]) {
      await expectUnavailable(secretStore.putSecret(input as never));
    }
    await expectUnavailable(secretStore.deleteSecret(null as never));
    await expectUnavailable(
      secretStore.deleteSecret(`other-prefix://${BINDING_ID}`),
    );
    expect(http).not.toHaveBeenCalled();

    for (const origin of [
      '',
      'not a url',
      'https://user@vault.example.test',
      'https://vault.example.test/',
      'https://vault.example.test/path',
      'https://vault.example.test?query=1',
    ]) {
      expect(() => new PluginVaultSecretStore(origin, TOKEN)).toThrow(
        PluginVaultSecretStoreError,
      );
    }
    expect(() => new PluginVaultSecretStore(null as never, TOKEN)).toThrow(
      PluginVaultSecretStoreError,
    );
    expect(() => new PluginVaultSecretStore('x'.repeat(2_049), TOKEN)).toThrow(
      PluginVaultSecretStoreError,
    );
    expect(
      () =>
        new PluginVaultSecretStore('https://vault.example.test', null as never),
    ).toThrow(PluginVaultSecretStoreError);
    expect(
      () =>
        new PluginVaultSecretStore(
          'https://vault.example.test',
          '123456789012345 ',
        ),
    ).toThrow(PluginVaultSecretStoreError);
    expect(
      () =>
        new PluginVaultSecretStore(
          'https://vault.example.test',
          'x'.repeat(2_049),
        ),
    ).toThrow(PluginVaultSecretStoreError);
    expect(
      () =>
        new PluginVaultSecretStore(
          'https://vault.example.test',
          TOKEN,
          null as never,
        ),
    ).toThrow(PluginVaultSecretStoreError);
  });

  it('rejects malformed durable Vault envelopes and stored authority before replay acceptance', async () => {
    const malformedBodies = [
      'null',
      '[]',
      '{}',
      '{"data":null}',
      '{"data":[]}',
      '{"data":{"data":[]}}',
      vaultRead({ schemaVersion: 2 }),
      vaultRead({ installationId: INSTALLATION_ID.toUpperCase() }),
      vaultRead({ workspaceId: WORKSPACE_ID.toUpperCase() }),
      vaultRead({ installedByUserId: USER_ID.toUpperCase() }),
      vaultRead({ credentialName: 'Bad Name' }),
      vaultRead({ secretValue: '' }),
    ];

    for (const body of malformedBodies) {
      const http = vi
        .fn<PluginVaultHttpClient>()
        .mockResolvedValueOnce(response(400))
        .mockResolvedValueOnce(response(200, body));
      await expectUnavailable(store(http).putSecret(INPUT));
    }
  });

  it('verifies exact durable bindings and fails closed on scope, transport, status, JSON, or secret conflict', async () => {
    const matching = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValue(response(200, vaultRead()));
    await expect(
      store(matching).verifySecret(REFERENCE, INPUT),
    ).resolves.toBeUndefined();

    const noIo = vi.fn<PluginVaultHttpClient>();
    await expectUnavailable(
      store(noIo).verifySecret(
        `lifeos-plugin-vault://${OTHER_BINDING_ID}`,
        INPUT,
      ),
    );
    expect(noIo).not.toHaveBeenCalled();

    await expectUnavailable(
      store(
        vi
          .fn<PluginVaultHttpClient>()
          .mockRejectedValue(new Error('vault down')),
      ).verifySecret(REFERENCE, INPUT),
    );
    await expectUnavailable(
      store(
        vi.fn<PluginVaultHttpClient>().mockResolvedValue(response(404)),
      ).verifySecret(REFERENCE, INPUT),
    );
    await expectUnavailable(
      store(
        vi.fn<PluginVaultHttpClient>().mockResolvedValue(response(200, '{')),
      ).verifySecret(REFERENCE, INPUT),
    );
    await expectUnavailable(
      store(
        vi
          .fn<PluginVaultHttpClient>()
          .mockResolvedValue(
            response(200, vaultRead({ secretValue: 'different secret' })),
          ),
      ).verifySecret(REFERENCE, INPUT),
    );
  });

  it('covers the default fetch transport and rejects malformed response and cleanup authority', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(204));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const defaultStore = new PluginVaultSecretStore(
        'https://vault.example.test',
        TOKEN,
      );
      await expect(defaultStore.putSecret(INPUT)).resolves.toBe(REFERENCE);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        method: 'POST',
        redirect: 'error',
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const malformedResponses: unknown[] = [
      null,
      [],
      { status: 99, headers: { get: () => null }, body: null },
      { status: 200.5, headers: { get: () => null }, body: null },
      { status: 600, headers: { get: () => null }, body: null },
      { status: 200, headers: {}, body: null },
      { status: 200, headers: { get: () => null }, body: {} },
    ];
    for (const durableResponse of malformedResponses) {
      const http = vi
        .fn<PluginVaultHttpClient>()
        .mockResolvedValue(durableResponse as PluginVaultHttpResponse);
      await expectUnavailable(store(http).putSecret(INPUT));
    }

    const cancelFailure = vi.fn<PluginVaultHttpClient>().mockResolvedValue({
      status: 200,
      headers: { get: () => null },
      body: {
        cancel: async () => {
          throw new Error('cleanup detail must not escape');
        },
      } as unknown as ReadableStream<Uint8Array>,
    });
    await expectUnavailable(store(cancelFailure).putSecret(INPUT));

    const noReader = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        body: {} as ReadableStream<Uint8Array>,
      });
    await expectUnavailable(store(noReader).putSecret(INPUT));

    const unsafeLength = vi
      .fn<PluginVaultHttpClient>()
      .mockResolvedValueOnce(response(400))
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => '9007199254740992' },
        body: streamFromText(vaultRead()),
      });
    await expectUnavailable(store(unsafeLength).putSecret(INPUT));
  });
});
