import { describe, expect, it, vi } from 'vitest';
import type { TrustedCalendarUserContext } from './calendar-service-context';
import {
  CalendarGoogleOAuthAuthorizationApplication,
  CalendarGoogleOAuthAuthorizationValidationError,
  type CalendarGoogleOAuthAuthorizationStateRepository,
  type CalendarGoogleOAuthVerifierSecretStore,
} from './calendar-google-oauth-authorization';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CANONICAL_STATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NONCANONICAL_STATE = CANONICAL_STATE.toUpperCase();
const REDIRECT_URI = 'https://life.example.test/calendar/google/callback';
const CONSUMED_AT = '2026-09-02T06:01:00.000Z';

const authority: TrustedCalendarUserContext = Object.freeze({
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
});

describe('Calendar Google OAuth callback state canonicality', () => {
  it('rejects a noncanonical state value before persistence lookup', async () => {
    const consumeAuthorizationState = vi.fn(async () => null);
    const states: CalendarGoogleOAuthAuthorizationStateRepository = {
      async createAuthorizationState(record) {
        return record;
      },
      consumeAuthorizationState,
    };
    const verifiers: CalendarGoogleOAuthVerifierSecretStore = {
      async writeVerifier() {
        return '44444444-4444-4444-8444-444444444444';
      },
      async readVerifier() {
        return 'abcdefghijklmnopqrstuvwxyzABCDEFGH0123456789-';
      },
      async deleteVerifier() {},
    };
    const application = new CalendarGoogleOAuthAuthorizationApplication(
      states,
      verifiers,
      REDIRECT_URI,
      { now: () => CONSUMED_AT },
    );

    await expect(
      application.consume(authority, {
        state: NONCANONICAL_STATE,
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toBeInstanceOf(CalendarGoogleOAuthAuthorizationValidationError);
    expect(consumeAuthorizationState).not.toHaveBeenCalled();
  });
});
