import { describe, expect, it } from 'vitest';
import {
  CalendarConflictError,
  CalendarDependencyError,
  type CalendarProviderWrite,
  CalendarValidationError,
  renderIcalendarEvent,
  validateCalendarTimeBlock,
} from './calendar-sync';
import {
  createGoogleCalendarEventId,
  GoogleCalendarProvider,
} from './google-calendar-provider';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const BLOCK_ID = '59b7f370-b733-435d-a72a-40878d6cffd1';
const RESOURCE_NAME = `life-os-${WORKSPACE_ID}-${BLOCK_ID}.ics`;
const SYNTHETIC_ACCESS_TOKEN = 'synthetic-google-access-token';

function providerWrite(
  precondition: CalendarProviderWrite['precondition'] = { kind: 'create' },
): CalendarProviderWrite {
  const block = validateCalendarTimeBlock({
    blockId: BLOCK_ID,
    title: 'Plan, review; next\nstep',
    startsAt: '2026-08-04T09:00:00+09:00',
    endsAt: '2026-08-04T10:00:00+09:00',
    timeZone: 'Asia/Seoul',
    version: precondition.kind === 'create' ? 1 : 2,
    ...(precondition.kind === 'update'
      ? { providerEtag: precondition.etag }
      : {}),
  });
  return Object.freeze({
    resourceName: RESOURCE_NAME,
    calendarData: renderIcalendarEvent(
      WORKSPACE_ID,
      block,
      new Date('2026-08-04T00:00:00.000Z'),
    ),
    precondition,
  });
}

describe('GoogleCalendarProvider', () => {
  it('creates one deterministic Google event without attendee notifications', async () => {
    const eventId = createGoogleCalendarEventId(RESOURCE_NAME);
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ url: input.toString(), init });
      return new Response(
        JSON.stringify({ id: eventId, etag: '"google-created-revision"' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const provider = new GoogleCalendarProvider({
      calendarId: 'primary',
      accessToken: SYNTHETIC_ACCESS_TOKEN,
      fetchImplementation,
    });

    await expect(provider.put(providerWrite())).resolves.toEqual({
      status: 'created',
      etag: '"google-created-revision"',
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',
    );
    expect(requests[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${SYNTHETIC_ACCESS_TOKEN}`,
        'content-type': 'application/json; charset=utf-8',
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      id: eventId,
      summary: 'Plan, review; next\nstep',
      start: {
        dateTime: '2026-08-04T00:00:00.000Z',
        timeZone: 'Asia/Seoul',
      },
      end: {
        dateTime: '2026-08-04T01:00:00.000Z',
        timeZone: 'Asia/Seoul',
      },
      sequence: 1,
      status: 'confirmed',
      transparency: 'opaque',
      extendedProperties: {
        private: {
          lifeOsWorkspaceId: WORKSPACE_ID,
          lifeOsBlockId: BLOCK_ID,
          lifeOsVersion: '1',
        },
      },
    });
    expect(eventId).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(createGoogleCalendarEventId(RESOURCE_NAME)).toBe(eventId);
  });

  it('updates only the deterministic event with the caller strong ETag', async () => {
    const eventId = createGoogleCalendarEventId(RESOURCE_NAME);
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ url: input.toString(), init });
      return new Response(
        JSON.stringify({ id: eventId, etag: '"google-updated-revision"' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const provider = new GoogleCalendarProvider({
      calendarId: 'team@example.com',
      accessToken: SYNTHETIC_ACCESS_TOKEN,
      fetchImplementation,
    });

    await expect(
      provider.put(
        providerWrite({ kind: 'update', etag: '"google-created-revision"' }),
      ),
    ).resolves.toEqual({
      status: 'updated',
      etag: '"google-updated-revision"',
    });

    expect(requests[0]?.url).toBe(
      `https://www.googleapis.com/calendar/v3/calendars/team%40example.com/events/${eventId}?sendUpdates=none`,
    );
    expect(requests[0]?.init).toMatchObject({
      method: 'PUT',
      headers: {
        'if-match': '"google-created-revision"',
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).not.toHaveProperty('id');
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      sequence: 2,
      extendedProperties: {
        private: { lifeOsVersion: '2' },
      },
    });
  });

  it('maps duplicate and stale writes to conflict without destructive fallback', async () => {
    const statuses = [409, 412];
    for (const status of statuses) {
      const methods: string[] = [];
      const provider = new GoogleCalendarProvider({
        calendarId: 'primary',
        accessToken: SYNTHETIC_ACCESS_TOKEN,
        fetchImplementation: async (_input, init) => {
          methods.push(init?.method ?? 'GET');
          return new Response(null, { status });
        },
      });
      await expect(provider.put(providerWrite())).rejects.toBeInstanceOf(
        CalendarConflictError,
      );
      expect(methods).toEqual(['POST']);
    }
  });

  it('rejects malformed contracts and bounded provider failures without leaking tokens', async () => {
    expect(
      () =>
        new GoogleCalendarProvider({
          calendarId: 'primary/other',
          accessToken: SYNTHETIC_ACCESS_TOKEN,
        }),
    ).toThrow('Invalid Google Calendar identifier configuration');
    expect(
      () =>
        new GoogleCalendarProvider({
          calendarId: 'primary',
          accessToken: 'token with whitespace',
        }),
    ).toThrow('Invalid Google Calendar access-token configuration');
    expect(() => createGoogleCalendarEventId('unsafe.ics')).toThrow(
      CalendarValidationError,
    );

    const malformedProvider = new GoogleCalendarProvider({
      calendarId: 'primary',
      accessToken: SYNTHETIC_ACCESS_TOKEN,
      fetchImplementation: async () =>
        new Response(
          JSON.stringify({ id: 'wrong-event', etag: '"revision"' }),
          { status: 200 },
        ),
    });
    await expect(
      malformedProvider.put(providerWrite()),
    ).rejects.toBeInstanceOf(CalendarDependencyError);

    const oversizedProvider = new GoogleCalendarProvider({
      calendarId: 'primary',
      accessToken: SYNTHETIC_ACCESS_TOKEN,
      fetchImplementation: async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': '65537' },
        }),
    });
    await expect(
      oversizedProvider.put(providerWrite()),
    ).rejects.toBeInstanceOf(CalendarDependencyError);

    const failingProvider = new GoogleCalendarProvider({
      calendarId: 'primary',
      accessToken: SYNTHETIC_ACCESS_TOKEN,
      timeoutMilliseconds: 100,
      fetchImplementation: async () => {
        throw new Error(`Bearer ${SYNTHETIC_ACCESS_TOKEN}`);
      },
    });
    const rejection = failingProvider.put(providerWrite());
    await expect(rejection).rejects.toBeInstanceOf(CalendarDependencyError);
    await expect(rejection).rejects.not.toThrow(SYNTHETIC_ACCESS_TOKEN);
  });
});
