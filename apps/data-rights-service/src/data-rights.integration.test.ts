import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import {
  type DataRightsDomain,
  type DataRightsParticipant,
  REQUIRED_DATA_RIGHTS_DOMAINS,
} from './data-rights';
import { DataRightsAppModule } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const CALLER_AUTHORIZATION = [
  'Bearer',
  ['integration', 'caller'].join('-'),
].join(' ');
const OTHER_AUTHORIZATION = ['Bearer', ['other', 'caller'].join('-')].join(
  ' ',
);
const DELETION_CONFIRMATION = 'erase-all-workspace-data';

class RecordingParticipant implements DataRightsParticipant {
  readonly schemaVersion: string;
  readonly exportedWorkspaces: string[] = [];
  readonly preparedWorkspaces: string[] = [];
  readonly committedWorkspaces: string[] = [];

  constructor(readonly domain: DataRightsDomain) {
    this.schemaVersion = `${domain}.v1`;
  }

  async exportWorkspace(workspaceId: string): Promise<readonly unknown[]> {
    this.exportedWorkspaces.push(workspaceId);
    return [{ domain: this.domain, workspaceScoped: true }];
  }

  async prepareDeletion(workspaceId: string, requestId: string) {
    this.preparedWorkspaces.push(workspaceId);
    return {
      workspaceId,
      requestId,
      token: `${this.domain}-prepared`,
    };
  }

  async commitDeletion(preparation: {
    workspaceId: string;
    requestId: string;
    token: string;
  }) {
    this.committedWorkspaces.push(preparation.workspaceId);
    return {
      workspaceId: preparation.workspaceId,
      requestId: preparation.requestId,
      deletedRecordCount: 1,
    };
  }
}

async function requestJson(
  port: number,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}${path}`, init);
}

function callerHeaders(): Record<string, string> {
  return {
    authorization: CALLER_AUTHORIZATION,
    'x-workspace-id': WORKSPACE_ID,
  };
}

describe('data rights production HTTP module', () => {
  it('exports every domain and completes an explicitly requested deletion', async () => {
    const participants = REQUIRED_DATA_RIGHTS_DOMAINS.map(
      (domain) => new RecordingParticipant(domain),
    );
    const app = await NestFactory.create(
      DataRightsAppModule.register(participants, CALLER_AUTHORIZATION),
      { logger: false },
    );
    await app.listen(0, '127.0.0.1');

    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const exportResponse = await requestJson(
        address.port,
        '/internal/v1/data-rights/export',
        {
          method: 'GET',
          headers: callerHeaders(),
        },
      );
      expect(exportResponse.status).toBe(200);
      const exported = (await exportResponse.json()) as {
        workspaceId: string;
        sections: Array<{ domain: string }>;
        contentDigest: string;
      };
      expect(exported.workspaceId).toBe(WORKSPACE_ID);
      expect(exported.sections.map((section) => section.domain)).toEqual(
        REQUIRED_DATA_RIGHTS_DOMAINS,
      );
      expect(exported.contentDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(
        participants.every(
          (participant) =>
            participant.exportedWorkspaces.length === 1 &&
            participant.exportedWorkspaces[0] === WORKSPACE_ID,
        ),
      ).toBe(true);

      const deletionResponse = await requestJson(
        address.port,
        '/internal/v1/data-rights/deletion',
        {
          method: 'POST',
          headers: {
            ...callerHeaders(),
            'content-type': 'application/json',
            'x-data-rights-confirmation': DELETION_CONFIRMATION,
          },
          body: JSON.stringify({ requestId: REQUEST_ID }),
        },
      );
      expect(deletionResponse.status).toBe(200);
      expect(await deletionResponse.json()).toMatchObject({
        status: 'complete',
        workspaceId: WORKSPACE_ID,
        requestId: REQUEST_ID,
      });
      expect(
        participants.every(
          (participant) =>
            participant.preparedWorkspaces.length === 1 &&
            participant.committedWorkspaces.length === 1,
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('rejects unauthenticated callers before any tenant participant runs', async () => {
    const participants = REQUIRED_DATA_RIGHTS_DOMAINS.map(
      (domain) => new RecordingParticipant(domain),
    );
    const app = await NestFactory.create(
      DataRightsAppModule.register(participants, CALLER_AUTHORIZATION),
      { logger: false },
    );
    await app.listen(0, '127.0.0.1');

    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const missingAuthorization = await requestJson(
        address.port,
        '/internal/v1/data-rights/export',
        {
          method: 'GET',
          headers: { 'x-workspace-id': WORKSPACE_ID },
        },
      );
      expect(missingAuthorization.status).toBe(401);

      const incorrectAuthorization = await requestJson(
        address.port,
        '/internal/v1/data-rights/deletion',
        {
          method: 'POST',
          headers: {
            authorization: OTHER_AUTHORIZATION,
            'content-type': 'application/json',
            'x-data-rights-confirmation': DELETION_CONFIRMATION,
            'x-workspace-id': WORKSPACE_ID,
          },
          body: JSON.stringify({ requestId: REQUEST_ID }),
        },
      );
      expect(incorrectAuthorization.status).toBe(401);
      expect(
        participants.every(
          (participant) =>
            participant.exportedWorkspaces.length === 0 &&
            participant.preparedWorkspaces.length === 0 &&
            participant.committedWorkspaces.length === 0,
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('rejects ownership injection, missing confirmation, and public routes', async () => {
    const participants = REQUIRED_DATA_RIGHTS_DOMAINS.map(
      (domain) => new RecordingParticipant(domain),
    );
    const app = await NestFactory.create(
      DataRightsAppModule.register(participants, CALLER_AUTHORIZATION),
      { logger: false },
    );
    await app.listen(0, '127.0.0.1');

    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const ownershipInjection = await requestJson(
        address.port,
        '/internal/v1/data-rights/deletion',
        {
          method: 'POST',
          headers: {
            ...callerHeaders(),
            'content-type': 'application/json',
            'x-data-rights-confirmation': DELETION_CONFIRMATION,
          },
          body: JSON.stringify({
            requestId: REQUEST_ID,
            workspaceId: OTHER_WORKSPACE_ID,
          }),
        },
      );
      expect(ownershipInjection.status).toBe(400);

      const missingConfirmation = await requestJson(
        address.port,
        '/internal/v1/data-rights/deletion',
        {
          method: 'POST',
          headers: {
            ...callerHeaders(),
            'content-type': 'application/json',
          },
          body: JSON.stringify({ requestId: REQUEST_ID }),
        },
      );
      expect(missingConfirmation.status).toBe(400);

      const publicExport = await requestJson(
        address.port,
        '/v1/data-rights/export',
        {
          method: 'GET',
          headers: callerHeaders(),
        },
      );
      expect(publicExport.status).toBe(404);
      expect(
        participants.every(
          (participant) => participant.committedWorkspaces.length === 0,
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
});
