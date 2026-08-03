import { describe, expect, it } from 'vitest';
import { DataRightsDependencyError } from './data-rights';
import { HttpDataRightsParticipant } from './http-participant';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const SERVICE_AUTHORIZATION = [
  'Bearer',
  ['participant', 'fixture'].join('-'),
].join(' ');
const MALFORMED_AUTHORIZATION = [
  SERVICE_AUTHORIZATION,
  'injected: value',
].join('\r\n');

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

describe('HttpDataRightsParticipant', () => {
  it('uses bounded HTTPS requests for export, preparation, and commit', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ url: input.toString(), init });
      const url = input.toString();
      if (url.endsWith('/export')) {
        return jsonResponse([{ id: 'record-one' }]);
      }
      if (url.endsWith('/prepare-deletion')) {
        return jsonResponse({
          workspaceId: WORKSPACE_ID,
          requestId: REQUEST_ID,
          token: 'prepared-fixture',
        });
      }
      return jsonResponse({
        workspaceId: WORKSPACE_ID,
        requestId: REQUEST_ID,
        deletedRecordCount: 1,
      });
    };
    const participant = new HttpDataRightsParticipant({
      domain: 'identity',
      schemaVersion: 'identity.v1',
      baseUrl: 'https://identity.internal.example/service',
      authorization: SERVICE_AUTHORIZATION,
      allowedHosts: ['identity.internal.example'],
      fetchImplementation,
    });

    await expect(participant.exportWorkspace(WORKSPACE_ID)).resolves.toEqual([
      { id: 'record-one' },
    ]);
    const preparation = await participant.prepareDeletion(
      WORKSPACE_ID,
      REQUEST_ID,
    );
    await expect(participant.commitDeletion(preparation)).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      deletedRecordCount: 1,
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://identity.internal.example/service/internal/v1/data-rights/export',
      'https://identity.internal.example/service/internal/v1/data-rights/prepare-deletion',
      'https://identity.internal.example/service/internal/v1/data-rights/commit-deletion',
    ]);
    expect(requests.every((request) => request.init?.redirect === 'error')).toBe(
      true,
    );
    expect(requests.every((request) => request.init?.cache === 'no-store')).toBe(
      true,
    );
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: SERVICE_AUTHORIZATION,
      'x-workspace-id': WORKSPACE_ID,
    });
    expect(requests[1]?.init?.body).toBe(
      JSON.stringify({ requestId: REQUEST_ID }),
    );
  });

  it('rejects unsafe endpoints and malformed authorization configuration', () => {
    expect(
      () =>
        new HttpDataRightsParticipant({
          domain: 'identity',
          schemaVersion: 'identity.v1',
          baseUrl: 'http://identity.internal.example/',
          authorization: SERVICE_AUTHORIZATION,
          allowedHosts: ['identity.internal.example'],
        }),
    ).toThrow();
    expect(
      () =>
        new HttpDataRightsParticipant({
          domain: 'identity',
          schemaVersion: 'identity.v1',
          baseUrl: 'https://attacker.example/',
          authorization: SERVICE_AUTHORIZATION,
          allowedHosts: ['identity.internal.example'],
        }),
    ).toThrow();
    expect(
      () =>
        new HttpDataRightsParticipant({
          domain: 'identity',
          schemaVersion: 'identity.v1',
          baseUrl: 'https://identity.internal.example/',
          authorization: MALFORMED_AUTHORIZATION,
          allowedHosts: ['identity.internal.example'],
        }),
    ).toThrow();
  });

  it('maps malformed, declared-oversized, and failed responses without credential leakage', async () => {
    const wrongContentType = new HttpDataRightsParticipant({
      domain: 'identity',
      schemaVersion: 'identity.v1',
      baseUrl: 'https://identity.internal.example/',
      authorization: SERVICE_AUTHORIZATION,
      allowedHosts: ['identity.internal.example'],
      fetchImplementation: async () =>
        new Response('not json', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    });
    await expect(
      wrongContentType.exportWorkspace(WORKSPACE_ID),
    ).rejects.toEqual(new DataRightsDependencyError());

    const oversized = new HttpDataRightsParticipant({
      domain: 'identity',
      schemaVersion: 'identity.v1',
      baseUrl: 'https://identity.internal.example/',
      authorization: SERVICE_AUTHORIZATION,
      allowedHosts: ['identity.internal.example'],
      fetchImplementation: async () =>
        new Response('[]', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(11 * 1024 * 1024),
          },
        }),
    });
    await expect(oversized.exportWorkspace(WORKSPACE_ID)).rejects.toEqual(
      new DataRightsDependencyError(),
    );

    const failed = new HttpDataRightsParticipant({
      domain: 'identity',
      schemaVersion: 'identity.v1',
      baseUrl: 'https://identity.internal.example/',
      authorization: SERVICE_AUTHORIZATION,
      allowedHosts: ['identity.internal.example'],
      fetchImplementation: async () => {
        throw new Error(SERVICE_AUTHORIZATION);
      },
    });
    const rejection = failed.exportWorkspace(WORKSPACE_ID);
    await expect(rejection).rejects.toBeInstanceOf(DataRightsDependencyError);
    await expect(rejection).rejects.not.toThrow('participant-fixture');
  });

  it('cancels chunked responses as soon as the streaming limit is exceeded', async () => {
    const chunk = new Uint8Array(6 * 1024 * 1024);
    const participant = new HttpDataRightsParticipant({
      domain: 'identity',
      schemaVersion: 'identity.v1',
      baseUrl: 'https://identity.internal.example/',
      authorization: SERVICE_AUTHORIZATION,
      allowedHosts: ['identity.internal.example'],
      fetchImplementation: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });

    await expect(participant.exportWorkspace(WORKSPACE_ID)).rejects.toEqual(
      new DataRightsDependencyError(),
    );
  });
});
