import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { InMemoryGoogleCalendarGateway } from './calendar-sync';
import {
  CalendarAppModule,
  GOOGLE_CALENDAR_GATEWAY,
} from './main';

const WORKSPACE_ID = '9ea7dd08-3d16-4bb2-9887-1d65d8ee7959';
const OTHER_WORKSPACE_ID = 'a2282c77-535a-4254-b692-f40c2a0366a4';
const SOURCE_ID = '099c178a-fbf2-4819-a064-71b840adf61b';

interface JsonHttpResponse {
  statusCode: number;
  body: unknown;
}

function postJson(
  address: AddressInfo,
  path: string,
  workspaceId: string | undefined,
  body: unknown,
): Promise<JsonHttpResponse> {
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'x-csrf-token': 'integration-test-token',
  };
  if (workspaceId) {
    headers['x-workspace-id'] = workspaceId;
  }
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: 'POST',
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: text ? JSON.parse(text) : null,
            });
          } catch {
            reject(new Error('Calendar HTTP response was not valid JSON'));
          }
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

const requestBody = {
  sourceId: SOURCE_ID,
  title: 'Protect product review time',
  description: 'Review the buyer-visible release evidence.',
  startAt: '2026-08-04T09:00:00+09:00',
  endAt: '2026-08-04T10:00:00+09:00',
} as const;

describe('Google calendar synchronization HTTP contract', () => {
  it('replays exactly, reschedules safely, and isolates workspaces without duplicates', async () => {
    const app = await NestFactory.create(CalendarAppModule, { logger: false });
    app.setGlobalPrefix('v1');
    await app.listen(0, '127.0.0.1');
    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const gateway = app.get(
        GOOGLE_CALENDAR_GATEWAY,
      ) as InMemoryGoogleCalendarGateway;

      const created = await postJson(
        address,
        '/v1/google/events/sync',
        WORKSPACE_ID,
        requestBody,
      );
      const replayed = await postJson(
        address,
        '/v1/google/events/sync',
        WORKSPACE_ID,
        requestBody,
      );
      const otherWorkspace = await postJson(
        address,
        '/v1/google/events/sync',
        OTHER_WORKSPACE_ID,
        requestBody,
      );
      const otherBeforeUpdate = gateway
        .snapshotEvents()
        .find((event) => event.workspaceId === OTHER_WORKSPACE_ID);
      const updated = await postJson(
        address,
        '/v1/google/events/sync',
        WORKSPACE_ID,
        {
          ...requestBody,
          startAt: '2026-08-04T10:30:00+09:00',
          endAt: '2026-08-04T11:30:00+09:00',
        },
      );
      const ownershipInjection = await postJson(
        address,
        '/v1/google/events/sync',
        WORKSPACE_ID,
        {
          ...requestBody,
          workspaceId: OTHER_WORKSPACE_ID,
        },
      );
      const missingWorkspace = await postJson(
        address,
        '/v1/google/events/sync',
        undefined,
        requestBody,
      );

      expect(created.statusCode).toBe(201);
      expect(created.body).toMatchObject({
        provider: 'google',
        workspaceId: WORKSPACE_ID,
        sourceId: SOURCE_ID,
        disposition: 'created',
        etag: '1',
      });
      expect(replayed.statusCode).toBe(201);
      expect(replayed.body).toMatchObject({
        providerEventId: (created.body as { providerEventId: string })
          .providerEventId,
        disposition: 'unchanged',
        etag: '1',
      });
      expect(otherWorkspace.statusCode).toBe(201);
      expect(otherWorkspace.body).toMatchObject({
        workspaceId: OTHER_WORKSPACE_ID,
        disposition: 'created',
      });
      expect(
        (otherWorkspace.body as { providerEventId: string }).providerEventId,
      ).not.toBe(
        (created.body as { providerEventId: string }).providerEventId,
      );
      expect(updated.statusCode).toBe(201);
      expect(updated.body).toMatchObject({
        providerEventId: (created.body as { providerEventId: string })
          .providerEventId,
        disposition: 'updated',
        etag: '2',
        startAt: '2026-08-04T01:30:00.000Z',
        endAt: '2026-08-04T02:30:00.000Z',
      });
      expect(ownershipInjection.statusCode).toBe(400);
      expect(ownershipInjection.body).toMatchObject({
        code: 'invalid_request',
      });
      expect(missingWorkspace.statusCode).toBe(400);
      expect(gateway.eventCount()).toBe(2);
      expect(
        gateway
          .snapshotEvents()
          .find((event) => event.workspaceId === OTHER_WORKSPACE_ID),
      ).toEqual(otherBeforeUpdate);
    } finally {
      await app.close();
    }
  });
});
