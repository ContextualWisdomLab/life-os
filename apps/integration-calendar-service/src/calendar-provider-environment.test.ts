import { describe, expect, it } from 'vitest';
import { CaldavCalendarProvider } from './calendar-sync';
import { GoogleCalendarProvider } from './google-calendar-provider';
import {
  createCalendarProviderFromEnvironment,
  createHostedCalendarProviderFromEnvironment,
} from './main';

const TEST_AUTHORIZATION_VALUE = ['unit', 'authorization', 'value'].join(':');

describe('calendar provider environment selection', () => {
  it('selects only explicitly configured Google or CalDAV adapters for standalone composition', () => {
    expect(
      createCalendarProviderFromEnvironment({
        CALENDAR_PROVIDER: 'google',
        GOOGLE_CALENDAR_ID: 'primary',
        GOOGLE_CALENDAR_ACCESS_TOKEN: TEST_AUTHORIZATION_VALUE,
      }),
    ).toBeInstanceOf(GoogleCalendarProvider);

    expect(
      createCalendarProviderFromEnvironment({
        CALENDAR_PROVIDER: 'caldav',
        CALDAV_CALENDAR_URL: 'https://calendar.example.com/users/test/',
        CALDAV_AUTHORIZATION: `Bearer ${TEST_AUTHORIZATION_VALUE}`,
        CALDAV_ALLOWED_HOSTS: 'calendar.example.com',
      }),
    ).toBeInstanceOf(CaldavCalendarProvider);

    expect(() =>
      createCalendarProviderFromEnvironment({ CALENDAR_PROVIDER: 'unknown' }),
    ).toThrow('Calendar provider configuration is unsupported');
    expect(() =>
      createCalendarProviderFromEnvironment({ CALENDAR_PROVIDER: 'google' }),
    ).toThrow('Google Calendar provider configuration is incomplete');
  });

  it('refuses deployment-wide Google credentials at the hosted multi-user boundary', () => {
    expect(() =>
      createHostedCalendarProviderFromEnvironment({
        CALENDAR_PROVIDER: 'google',
        GOOGLE_CALENDAR_ID: 'primary',
        GOOGLE_CALENDAR_ACCESS_TOKEN: TEST_AUTHORIZATION_VALUE,
      }),
    ).toThrow(
      'Hosted Google Calendar requires user-scoped credential authority',
    );

    expect(
      createHostedCalendarProviderFromEnvironment({
        CALENDAR_PROVIDER: 'caldav',
        CALDAV_CALENDAR_URL: 'https://calendar.example.com/users/test/',
        CALDAV_AUTHORIZATION: `Bearer ${TEST_AUTHORIZATION_VALUE}`,
        CALDAV_ALLOWED_HOSTS: 'calendar.example.com',
      }),
    ).toBeInstanceOf(CaldavCalendarProvider);
  });
});
