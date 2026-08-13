import { describe, expect, it, vi } from 'vitest';
import { CalendarConnectionCreateApplication } from './calendar-connection-create';
import { CalendarConnectionDisconnectApplication } from './calendar-connection-disconnect';
import { CalendarConnectionReadApplication } from './calendar-connection-read';
import type { CalendarConnectionLifecycleRuntime } from './calendar-connection-runtime';
import { CaldavCalendarProvider } from './calendar-sync';
import { GoogleCalendarProvider } from './google-calendar-provider';
import {
  CALENDAR_CONNECTION_LIFECYCLE_RUNTIME,
  CalendarConnectionController,
  CalendarConnectionCreateController,
  CalendarConnectionReadController,
  createCalendarAppModuleFromEnvironment,
  createCalendarProviderFromEnvironment,
} from './main';

const TEST_AUTHORIZATION_VALUE = ['unit', 'authorization', 'value'].join(':');
const CALDAV_ENVIRONMENT = Object.freeze({
  CALENDAR_PROVIDER: 'caldav',
  CALDAV_CALENDAR_URL: 'https://calendar.example.com/users/test/',
  CALDAV_AUTHORIZATION: `Bearer ${TEST_AUTHORIZATION_VALUE}`,
  CALDAV_ALLOWED_HOSTS: 'calendar.example.com',
});

describe('calendar provider environment selection', () => {
  it('selects only explicitly configured Google or CalDAV adapters', () => {
    expect(
      createCalendarProviderFromEnvironment({
        CALENDAR_PROVIDER: 'google',
        GOOGLE_CALENDAR_ID: 'primary',
        GOOGLE_CALENDAR_ACCESS_TOKEN: TEST_AUTHORIZATION_VALUE,
      }),
    ).toBeInstanceOf(GoogleCalendarProvider);

    expect(createCalendarProviderFromEnvironment(CALDAV_ENVIRONMENT)).toBeInstanceOf(
      CaldavCalendarProvider,
    );

    expect(() =>
      createCalendarProviderFromEnvironment({ CALENDAR_PROVIDER: 'unknown' }),
    ).toThrow('Calendar provider configuration is unsupported');
    expect(() =>
      createCalendarProviderFromEnvironment({ CALENDAR_PROVIDER: 'google' }),
    ).toThrow('Google Calendar provider configuration is incomplete');
  });

  it('keeps hosted connection lifecycle disabled unless explicitly enabled', () => {
    const lifecycleFactory = vi.fn();
    const module = createCalendarAppModuleFromEnvironment(
      CALDAV_ENVIRONMENT,
      lifecycleFactory,
    );

    expect(lifecycleFactory).not.toHaveBeenCalled();
    expect(module.controllers).not.toContain(CalendarConnectionCreateController);
    expect(module.controllers).not.toContain(CalendarConnectionReadController);
    expect(module.controllers).not.toContain(CalendarConnectionController);
  });

  it('composes the lifecycle runtime into hosted create, read, disconnect, and shutdown boundaries', () => {
    const lifecycle = {
      createApplication: Object.create(
        CalendarConnectionCreateApplication.prototype,
      ) as CalendarConnectionCreateApplication,
      readApplication: Object.create(
        CalendarConnectionReadApplication.prototype,
      ) as CalendarConnectionReadApplication,
      disconnectApplication: Object.create(
        CalendarConnectionDisconnectApplication.prototype,
      ) as CalendarConnectionDisconnectApplication,
      close: vi.fn(async () => undefined),
      onApplicationShutdown: vi.fn(async () => undefined),
    } as unknown as CalendarConnectionLifecycleRuntime;
    const lifecycleFactory = vi.fn(() => lifecycle);
    const environment = {
      ...CALDAV_ENVIRONMENT,
      CALENDAR_CONNECTION_LIFECYCLE_ENABLED: 'true',
    };

    const module = createCalendarAppModuleFromEnvironment(
      environment,
      lifecycleFactory,
    );

    expect(lifecycleFactory).toHaveBeenCalledWith(environment);
    expect(module.controllers).toEqual(
      expect.arrayContaining([
        CalendarConnectionCreateController,
        CalendarConnectionReadController,
        CalendarConnectionController,
      ]),
    );
    expect(module.providers).toEqual(
      expect.arrayContaining([
        {
          provide: CALENDAR_CONNECTION_LIFECYCLE_RUNTIME,
          useValue: lifecycle,
        },
      ]),
    );
  });

  it('rejects ambiguous lifecycle mode instead of silently changing deployment authority', () => {
    expect(() =>
      createCalendarAppModuleFromEnvironment({
        ...CALDAV_ENVIRONMENT,
        CALENDAR_CONNECTION_LIFECYCLE_ENABLED: 'yes',
      }),
    ).toThrow('Calendar connection lifecycle mode is invalid');
  });
});
