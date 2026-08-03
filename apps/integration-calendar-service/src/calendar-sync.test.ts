import { describe, expect, it } from 'vitest';
import {
  CaldavCalendarProvider,
  CalendarConflictError,
  CalendarDependencyError,
  type CalendarProvider,
  CalendarSyncService,
  CalendarValidationError,
  renderIcalendarEvent,
  validateCalendarTimeBlock,
} from './calendar-sync';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const BLOCK_ID = '59b7f370-b733-435d-a72a-40878d6cffd1';

const block = {
  blockId: BLOCK_ID,
  title: 'Prepare launch',
  startsAt: '2026-08-04T09:00:00+09:00',
  endsAt: '2026-08-04T10:00:00+09:00',
  timeZone: 'Asia/Seoul',
  version: 1,
} as const;

describe('calendar synchronization domain', () => {
  it('renders deterministic UTC VEVENT data with RFC line folding', () => {
    const validated = validateCalendarTimeBlock({
      ...block,
      title: `긴 일정 ${'가'.repeat(100)}`,
    });
    const calendarData = renderIcalendarEvent(
      WORKSPACE_ID,
      validated,
      new Date('2026-08-04T00:00:00.000Z'),
    );

    expect(calendarData).toContain(
      `UID:${WORKSPACE_ID}.${BLOCK_ID}@life-os`,
    );
    expect(calendarData).toContain('DTSTART:20260804T000000Z');
    expect(calendarData).toContain('DTEND:20260804T010000Z');
    expect(calendarData).not.toContain('\nMETHOD:');
    for (const line of calendarData.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  it('rejects malformed identifiers, time zones, ranges, ETags, and ownership fields', () => {
    expect(() => validateCalendarTimeBlock({ ...block, blockId: '1' })).toThrow(
      CalendarValidationError,
    );
    expect(() =>
      validateCalendarTimeBlock({ ...block, timeZone: 'Mars/Olympus' }),
    ).toThrow(CalendarValidationError);
    expect(() =>
      validateCalendarTimeBlock({
        ...block,
        endsAt: block.startsAt,
      }),
    ).toThrow(CalendarValidationError);
    expect(() =>
      validateCalendarTimeBlock({ ...block, providerEtag: 'W/"weak"' }),
    ).toThrow(CalendarValidationError);
    expect(() =>
      validateCalendarTimeBlock({ ...block, workspaceId: WORKSPACE_ID }),
    ).toThrow(CalendarValidationError);
  });

  it('passes only create or strong-ETag update operations to the provider', async () => {
    const writes: unknown[] = [];
    const provider: CalendarProvider = {
      async put(write) {
        writes.push(write);
        return {
          status: write.precondition.kind === 'create' ? 'created' : 'updated',
          etag: '"provider-revision"',
        };
      },
    };
    const service = new CalendarSyncService(
      provider,
      () => new Date('2026-08-04T00:00:00.000Z'),
    );

    await service.sync(WORKSPACE_ID, block);
    await service.sync(WORKSPACE_ID, {
      ...block,
      providerEtag: '"provider-revision"',
      version: 2,
    });

    expect(writes).toMatchObject([
      { precondition: { kind: 'create' } },
      {
        precondition: {
          kind: 'update',
          etag: '"provider-revision"',
        },
      },
    ]);
  });
});

describe('CaldavCalendarProvider', () => {
  it('uses deterministic PUT resources and RFC precondition headers', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      requests.push({ url: input.toString(), init });
      return new Response(null, {
        status: 201,
        headers: { etag: '"created-revision"' },
      });
    };
    const provider = new CaldavCalendarProvider({
      calendarUrl: 'https://cal.example.com/users/example/calendar',
      authorization: 'Bearer synthetic-secret',
      allowedHosts: ['cal.example.com'],
      fetchImplementation,
    });

    const receipt = await provider.put({
      resourceName: `life-os-${WORKSPACE_ID}-${BLOCK_ID}.ics`,
      calendarData: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      precondition: { kind: 'create' },
    });

    expect(receipt).toEqual({
      status: 'created',
      etag: '"created-revision"',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      `https://cal.example.com/users/example/calendar/life-os-${WORKSPACE_ID}-${BLOCK_ID}.ics`,
    );
    expect(requests[0]?.init).toMatchObject({
      method: 'PUT',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        authorization: 'Bearer synthetic-secret',
        'if-none-match': '*',
      },
    });
  });

  it('uses If-Match for updates and fetches an ETag when PUT omits it', async () => {
    const methods: string[] = [];
    const fetchImplementation: typeof fetch = async (_input, init) => {
      methods.push(init?.method ?? 'GET');
      if (init?.method === 'PUT') {
        expect(init.headers).toMatchObject({
          'if-match': '"previous-revision"',
        });
        return new Response(null, { status: 204 });
      }
      return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', {
        status: 200,
        headers: { etag: '"fetched-revision"' },
      });
    };
    const provider = new CaldavCalendarProvider({
      calendarUrl: 'https://cal.example.com/calendar/',
      authorization: 'Basic synthetic-secret',
      allowedHosts: ['cal.example.com'],
      fetchImplementation,
    });

    await expect(
      provider.put({
        resourceName: `life-os-${WORKSPACE_ID}-${BLOCK_ID}.ics`,
        calendarData: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        precondition: { kind: 'update', etag: '"previous-revision"' },
      }),
    ).resolves.toEqual({
      status: 'updated',
      etag: '"fetched-revision"',
    });
    expect(methods).toEqual(['PUT', 'GET']);
  });

  it('maps provider conflicts and rejects unsafe endpoint configuration', async () => {
    const conflictingFetch: typeof fetch = async () =>
      new Response(null, { status: 412 });
    const provider = new CaldavCalendarProvider({
      calendarUrl: 'https://cal.example.com/calendar/',
      authorization: 'Bearer synthetic-secret',
      allowedHosts: ['cal.example.com'],
      fetchImplementation: conflictingFetch,
    });
    await expect(
      provider.put({
        resourceName: `life-os-${WORKSPACE_ID}-${BLOCK_ID}.ics`,
        calendarData: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        precondition: { kind: 'create' },
      }),
    ).rejects.toBeInstanceOf(CalendarConflictError);

    expect(
      () =>
        new CaldavCalendarProvider({
          calendarUrl: 'http://cal.example.com/calendar/',
          authorization: 'Bearer secret',
          allowedHosts: ['cal.example.com'],
        }),
    ).toThrow();
    expect(
      () =>
        new CaldavCalendarProvider({
          calendarUrl: 'https://attacker.example/calendar/',
          authorization: 'Bearer secret',
          allowedHosts: ['cal.example.com'],
        }),
    ).toThrow();
  });

  it('maps network failures without leaking credentials', async () => {
    const failingFetch: typeof fetch = async () => {
      throw new Error('Bearer super-secret');
    };
    const provider = new CaldavCalendarProvider({
      calendarUrl: 'https://cal.example.com/calendar/',
      authorization: 'Bearer super-secret',
      allowedHosts: ['cal.example.com'],
      fetchImplementation: failingFetch,
      timeoutMilliseconds: 100,
    });

    const rejection = provider.put({
      resourceName: `life-os-${WORKSPACE_ID}-${BLOCK_ID}.ics`,
      calendarData: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
      precondition: { kind: 'create' },
    });
    await expect(rejection).rejects.toBeInstanceOf(CalendarDependencyError);
    await expect(rejection).rejects.not.toThrow('super-secret');
  });
});
