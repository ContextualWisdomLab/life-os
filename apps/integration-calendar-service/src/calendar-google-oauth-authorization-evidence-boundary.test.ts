import { describe, expect, it, vi } from 'vitest';
import type { TrustedCalendarUserContext } from './calendar-service-context';
import {
  CalendarGoogleOAuthAuthorizationApplication,
  CalendarGoogleOAuthAuthorizationDependencyError,
  type CalendarGoogleOAuthAuthorizationStateRecord,
  type CalendarGoogleOAuthAuthorizationStateRepository,
  type CalendarGoogleOAuthVerifierSecretStore,
} from './calendar-google-oauth-authorization';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const STATE_ID = '33333333-3333-4333-8333-333333333333';
const SECRET_REFERENCE = '44444444-4444-4444-8444-444444444444';
const REDIRECT_URI = 'https://life.example.test/calendar/google/callback';
const CREATED_AT = '2026-09-02T06:00:00.000Z';
const EXPIRES_AT = '2026-09-02T06:05:00.000Z';
const CONSUMED_AT = '2026-09-02T06:01:00.000Z';
const CHALLENGE = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const authority: TrustedCalendarUserContext = Object.freeze({
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
});

function hostileConsumedRecord(): CalendarGoogleOAuthAuthorizationStateRecord {
  const record: CalendarGoogleOAuthAuthorizationStateRecord = Object.freeze({
    stateId: STATE_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    purpose: 'google_calendar_oauth_authorization',
    redirectUri: REDIRECT_URI,
    verifierSecretReference: SECRET_REFERENCE,
    codeChallenge: CHALLENGE,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    consumedAt: CONSUMED_AT,
  });
  return new Proxy(record, {
    get(target, property, receiver) {
      if (property === 'verifierSecretReference') {
        throw new Error('password=must-not-escape-oauth-state-evidence');
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

describe('Calendar Google OAuth consumed-state evidence boundary', () => {
  it('collapses throwing persistence evidence before secret materialization', async () => {
    const states: CalendarGoogleOAuthAuthorizationStateRepository = {
      async createAuthorizationState(record) {
        return record;
      },
      async consumeAuthorizationState() {
        return hostileConsumedRecord();
      },
    };
    const readVerifier = vi.fn(async () => 'unused-verifier-material');
    const verifiers: CalendarGoogleOAuthVerifierSecretStore = {
      async writeVerifier() {
        return SECRET_REFERENCE;
      },
      readVerifier,
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
        state: STATE_ID,
        redirectUri: REDIRECT_URI,
      }),
    ).rejects.toBeInstanceOf(CalendarGoogleOAuthAuthorizationDependencyError);
    expect(readVerifier).not.toHaveBeenCalled();
  });
});
