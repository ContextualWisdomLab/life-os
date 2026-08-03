import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import {
  CalendarConflictError,
  type CalendarProvider,
  type CalendarProviderReceipt,
  type CalendarProviderWrite,
} from './calendar-sync';
import { CalendarAppModule } from './main';

const WORKSPACE_ID = 'e021b411-f75e-4490-97a4-f1f6ee811849';
const OTHER_WORKSPACE_ID = '474c83ae-08af-4a63-957b-49eb2093a61d';
const BLOCK_ID = '1f06da41-cf62-4387-adad-6f53dd8ee66c';
const SYNTHETIC_CSRF_TOKEN = 'synthetic-test-csrf-token';

interface StoredCalendarResource {
  readonly calendarData: string;
  readonly etag: string;
}

class ConflictSafeRecordingProvider implements CalendarProvider {
  readonly resources = new Map<string, StoredCalendarResource>();
  readonly methods: string[] = [];
  private revision = 0;

  async put(write: CalendarProviderWrite): Promise<CalendarProviderReceipt> {
    this.methods.push('PUT');
    const existing = this.resources.get(write.resourceName);
    if (write.precondition.kind === 'create' && existing) {
      throw new CalendarConflictError();
    }
    if (
      write.precondition.kind === 'update' &&
      (!existing || existing.etag !== write.precondition.etag)
    ) {
      throw new CalendarConflictError();
    }
    this.revision += 1;
    const etag = `"revision-${this.revision}"`;
    this.resources.set(
      write.resourceName,
      Object.freeze({ calendarData: write.calendarData, etag }),
    );
    return Object.freeze({
      status: write.precondition.kind === 'create' ? 'created' : 'updated',
      etag,
    });
  }
}

function timeBlock(providerEtag?: string): Record<string, unknown> {
  const base = {
    blockId: BLOCK_ID,
    title: 'Plan, review; next\nstep',
    startsAt: '2026-08-04T09:00:00+09:00',
    endsAt: '2026-08-04T10:00:00+09:00',
    timeZone: 'Asia/Seoul',
    version: providerEtag ? 2 : 1,
  };
  return providerEtag ? { ...base, providerEtag } : base;
}

async function postSync(
  port: number,
  workspaceId: string,
  body: unknown,
): Promise<Response> {
  return await fetch(`http://127.0.0.1:${port}/v1/calendar/sync`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': SYNTHETIC_CSRF_TOKEN,
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify(body),
  });
}

describe('calendar synchronization HTTP boundary', () => {
  it('prevents duplicates and silent overwrites while retaining tenant isolation', async () => {
    const provider = new ConflictSafeRecordingProvider();
    const app = await NestFactory.create(CalendarAppModule.register(provider), {
      logger: false,
    });
    await app.listen(0, '127.0.0.1');

    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const createdResponse = await postSync(
        address.port,
        WORKSPACE_ID,
        timeBlock(),
      );
      expect(createdResponse.status).toBe(200);
      const created = (await createdResponse.json()) as {
        status: string;
        etag: string;
        resourceName: string;
      };
      expect(created).toMatchObject({
        status: 'created',
        etag: '"revision-1"',
        resourceName: `life-os-${WORKSPACE_ID}-${BLOCK_ID}.ics`,
      });

      const duplicateResponse = await postSync(
        address.port,
        WORKSPACE_ID,
        timeBlock(),
      );
      expect(duplicateResponse.status).toBe(409);
      expect(provider.resources.size).toBe(1);

      const staleUpdateResponse = await postSync(
        address.port,
        WORKSPACE_ID,
        timeBlock('"stale-revision"'),
      );
      expect(staleUpdateResponse.status).toBe(409);

      const updatedResponse = await postSync(
        address.port,
        WORKSPACE_ID,
        timeBlock(created.etag),
      );
      expect(updatedResponse.status).toBe(200);
      expect(await updatedResponse.json()).toMatchObject({
        status: 'updated',
        etag: '"revision-2"',
      });
      expect(provider.resources.size).toBe(1);

      const otherTenantResponse = await postSync(
        address.port,
        OTHER_WORKSPACE_ID,
        timeBlock(),
      );
      expect(otherTenantResponse.status).toBe(200);
      expect(provider.resources.size).toBe(2);

      const storedResources = Array.from(provider.resources.values());
      expect(storedResources).toHaveLength(2);
      expect(storedResources[0]?.calendarData).toContain(
        'SUMMARY:Plan\\, review\\; next\\nstep',
      );
      expect(storedResources[0]?.calendarData).toContain(
        `UID:${WORKSPACE_ID}.${BLOCK_ID}@life-os`,
      );
      expect(storedResources[0]?.calendarData).not.toContain('authorization');
      expect(provider.methods.every((method) => method === 'PUT')).toBe(true);

      const unsupportedDelete = await fetch(
        `http://127.0.0.1:${address.port}/v1/calendar/sync`,
        {
          method: 'DELETE',
          headers: {
            'x-csrf-token': SYNTHETIC_CSRF_TOKEN,
            'x-workspace-id': WORKSPACE_ID,
          },
        },
      );
      expect(unsupportedDelete.status).toBe(404);

      const ownershipInjection = await postSync(address.port, WORKSPACE_ID, {
        ...timeBlock(),
        workspaceId: OTHER_WORKSPACE_ID,
      });
      expect(ownershipInjection.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});
