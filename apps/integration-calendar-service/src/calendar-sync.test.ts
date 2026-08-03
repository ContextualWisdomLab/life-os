import { describe, expect, it } from 'vitest';
import {
  CalendarProviderError,
  CalendarSyncService,
  CalendarValidationError,
  createGoogleEventId,
  type GoogleCalendarGateway,
  InMemoryGoogleCalendarGateway,
  parseCalendarSyncRequest,
} from './calendar-sync';

const WORKSPACE_ID = '11dc2937-ffcb-446e-b4e5-4fffe635dafd';
const OTHER_WORKSPACE_ID = '799fab2b-a221-4963-86c3-1c08c7fa9c13';
const SOURCE_ID = '3db386bf-882a-47fe-a86b-f08a67a3b486';

const request = {
  sourceId: SOURCE_ID,
  title: 'Prepare launch review',
  description: 'Review the release evidence before deployment.',
  startAt: '2026-08-04T09:00:00+09:00',
  endAt: '2026-08-04T10:00:00+09:00',
} as const;

describe('calendar synchronization', () => {
  it('derives stable opaque Google event IDs per workspace and source', () => {
    const eventId = createGoogleEventId(WORKSPACE_ID, SOURCE_ID);

    expect(eventId).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(eventId).toBe(createGoogleEventId(WORKSPACE_ID, SOURCE_ID));
    expect(eventId).not.toContain(WORKSPACE_ID);
    expect(eventId).not.toContain(SOURCE_ID);
    expect(eventId).not.toBe(
      createGoogleEventId(OTHER_WORKSPACE_ID, SOURCE_ID),
    );
  });

  it('canonicalizes bounded input and rejects ownership injection', () => {
    expect(parseCalendarSyncRequest(request)).toEqual({
      sourceId: SOURCE_ID,
      title: 'Prepare launch review',
      description: 'Review the release evidence before deployment.',
      startAt: '2026-08-04T00:00:00.000Z',
      endAt: '2026-08-04T01:00:00.000Z',
    });

    expect(() =>
      parseCalendarSyncRequest({
        ...request,
        workspaceId: WORKSPACE_ID,
      }),
    ).toThrow(CalendarValidationError);
    expect(() =>
      parseCalendarSyncRequest({
        ...request,
        sourceId: 42,
      }),
    ).toThrow(CalendarValidationError);
    expect(() =>
      parseCalendarSyncRequest({
        ...request,
        endAt: request.startAt,
      }),
    ).toThrow(CalendarValidationError);
    expect(() =>
      parseCalendarSyncRequest({
        ...request,
        endAt: '2026-08-12T09:00:00+09:00',
      }),
    ).toThrow(CalendarValidationError);
  });

  it('creates once, replays unchanged, and updates only the same managed event', async () => {
    let currentTime = new Date('2026-08-04T00:00:00.000Z');
    const gateway = new InMemoryGoogleCalendarGateway(() => currentTime);
    const service = new CalendarSyncService(gateway);

    const created = await service.synchronize(WORKSPACE_ID, request);
    const replayed = await service.synchronize(WORKSPACE_ID, request);
    currentTime = new Date('2026-08-04T00:05:00.000Z');
    const updated = await service.synchronize(WORKSPACE_ID, {
      ...request,
      startAt: '2026-08-04T10:00:00+09:00',
      endAt: '2026-08-04T11:00:00+09:00',
    });

    expect(created.disposition).toBe('created');
    expect(created.etag).toBe('1');
    expect(replayed).toMatchObject({
      providerEventId: created.providerEventId,
      disposition: 'unchanged',
      etag: '1',
    });
    expect(updated).toMatchObject({
      providerEventId: created.providerEventId,
      disposition: 'updated',
      etag: '2',
      startAt: '2026-08-04T01:00:00.000Z',
      endAt: '2026-08-04T02:00:00.000Z',
    });
    expect(gateway.eventCount()).toBe(1);
    expect(gateway.snapshotEvents()).toEqual([
      {
        eventId: created.providerEventId,
        workspaceId: WORKSPACE_ID,
        sourceId: SOURCE_ID,
        title: request.title,
        description: request.description,
        startAt: '2026-08-04T01:00:00.000Z',
        endAt: '2026-08-04T02:00:00.000Z',
      },
    ]);
  });

  it('fails closed when a provider acknowledges a different event', async () => {
    const unsafeGateway: GoogleCalendarGateway = {
      async upsertEvent() {
        return {
          eventId: 'lifeos000000000000000000000000000000000000000000000000',
          disposition: 'created',
          etag: '1',
          updatedAt: '2026-08-04T00:00:00.000Z',
        };
      },
    };
    const service = new CalendarSyncService(unsafeGateway);

    await expect(service.synchronize(WORKSPACE_ID, request)).rejects.toThrow(
      CalendarProviderError,
    );
  });
});
