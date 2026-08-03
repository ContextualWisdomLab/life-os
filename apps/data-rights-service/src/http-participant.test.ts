import { describe, expect, it } from 'vitest';
import { DataRightsDependencyError } from './data-rights';
import { HttpDataRightsParticipant } from './http-participant';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

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
          token: 'prepared-token',
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
      authorization: 'Bearer synthetic-service-token',
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
      authorization: 'Bearer synthetic-service-token',
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
          authorization: 'Bearer token',
          allowedHosts: ['identity.internal.example'],
        }),
    ).toThrow();
    expect(
      () =>
        new HttpDataRightsParticipant({
          domain: 'identity',
          schemaVersion: 'identity.v1',
          baseUrl: 'https://attacker.example/',
          authorization: 'Bearer token',
          allowedHosts: ['identity.internal.example'],
        }),
    ).toThrow();
    expect(
      () =>
        new HttpDataRightsParticipant({
          domain: 'identity',
          schemaVersion: 'identity.v1',
          baseUrl: 'https://identity.internal.example/',
          authorization: 'Bearer token\r\ninjected: value',
          allowedHosts: ['identity.internal.example'],
        }),
    ).toThrow();
  });

  it('maps malformed, oversized, and failed responses without leaking credentials', async () => {
    const wrongContentType = new HttpDataRightsParticipant({
      domain: 'identity',
      schemaVersion: 'identity.v1',
      baseUrl: 'https://identity.internal.example/',
      authorization: 'Bearer super-secret',
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
      authorization: 'Bearer super-secret',
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
      authorization: 'Bearer super-secret',
      allowedHosts: ['identity.internal.example'],
      fetchImplementation: async () => {
        throw new Error('Bearer super-secret');
      },
    });
    const rejection = failed.exportWorkspace(WORKSPACE_ID);
    await expect(rejection).rejects.toBeInstanceOf(DataRightsDependencyError);
    await expect(rejection).rejects.not.toThrow('super-secret');
  });
});
