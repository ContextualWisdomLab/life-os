import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TrustedCalendarUserContext } from './calendar-service-context';
import {
  CalendarGoogleOAuthAuthorizationApplication,
  CalendarGoogleOAuthAuthorizationDependencyError,
  CalendarGoogleOAuthAuthorizationValidationError,
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
const VERIFIER = 'abcdefghijklmnopqrstuvwxyzABCDEFGH0123456789-';
const CHALLENGE = createHash('sha256').update(VERIFIER, 'ascii').digest('base64url');

const authority: TrustedCalendarUserContext = Object.freeze({
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
});

class MemoryOAuthStore
  implements CalendarGoogleOAuthAuthorizationStateRepository, CalendarGoogleOAuthVerifierSecretStore
{
  readonly records = new Map<string, CalendarGoogleOAuthAuthorizationStateRecord>();
  readonly secrets = new Map<string, string>();
  readonly deletedReferences: string[] = [];
  failCreate = false;
  failRead = false;
  secretReference = SECRET_REFERENCE;

  async writeVerifier(input: { readonly verifier: string }): Promise<string> {
    this.secrets.set(this.secretReference, input.verifier);
    return this.secretReference;
  }

  async deleteVerifier(secretReference: string): Promise<void> {
    this.deletedReferences.push(secretReference);
    this.secrets.delete(secretReference);
  }

  async readVerifier(secretReference: string): Promise<string> {
    if (this.failRead) {
      throw new Error('kms unavailable');
    }
    const value = this.secrets.get(secretReference);
    if (!value) {
      throw new Error('missing verifier');
    }
    return value;
  }

  async createAuthorizationState(
    record: CalendarGoogleOAuthAuthorizationStateRecord,
  ): Promise<CalendarGoogleOAuthAuthorizationStateRecord> {
    if (this.failCreate) {
      throw new Error('database unavailable');
    }
    this.records.set(record.stateId, record);
    return record;
  }

  async consumeAuthorizationState(input: {
    readonly stateId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly redirectUri: string;
    readonly consumedAt: string;
  }): Promise<CalendarGoogleOAuthAuthorizationStateRecord | null> {
    const record = this.records.get(input.stateId);
    if (
      !record ||
      record.workspaceId !== input.workspaceId ||
      record.userId !== input.userId ||
      record.redirectUri !== input.redirectUri ||
      record.consumedAt !== null ||
      Date.parse(record.expiresAt) <= Date.parse(input.consumedAt)
    ) {
      return null;
    }
    const consumed = Object.freeze({ ...record, consumedAt: input.consumedAt });
    this.records.set(input.stateId, consumed);
    return consumed;
  }
}

function subject(
  store = new MemoryOAuthStore(),
  now = vi.fn(() => CREATED_AT),
): {
  readonly application: CalendarGoogleOAuthAuthorizationApplication;
  readonly store: MemoryOAuthStore;
} {
  return {
    application: new CalendarGoogleOAuthAuthorizationApplication(
      store,
      store,
      REDIRECT_URI,
      {
        now,
        createStateId: () => STATE_ID,
        createVerifier: () => VERIFIER,
      },
    ),
    store,
  };
}

describe('CalendarGoogleOAuthAuthorizationApplication', () => {
  it('issues tenant/user/purpose-bound state and an S256 challenge without returning the verifier', async () => {
    const { application, store } = subject();

    const issued = await application.issue(authority, { redirectUri: REDIRECT_URI });

    expect(issued).toEqual({
      state: STATE_ID,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      expiresAt: EXPIRES_AT,
    });
    expect(Object.keys(issued)).not.toContain('codeVerifier');
    expect(store.records.get(STATE_ID)).toEqual({
      stateId: STATE_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      purpose: 'google_calendar_oauth_authorization',
      redirectUri: REDIRECT_URI,
      verifierSecretReference: SECRET_REFERENCE,
      codeChallenge: CHALLENGE,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      consumedAt: null,
    });
  });

  it.each([
    'http://life.example.test/calendar/google/callback',
    'https://life.example.test/calendar/google/callback?next=/today',
    'https://other.example.test/calendar/google/callback',
  ])('rejects redirect confusion before writing verifier material: %s', async (redirectUri) => {
    const { application, store } = subject();

    await expect(application.issue(authority, { redirectUri })).rejects.toBeInstanceOf(
      CalendarGoogleOAuthAuthorizationValidationError,
    );
    expect(store.secrets.size).toBe(0);
    expect(store.records.size).toBe(0);
  });

  it('compensates verifier material when durable state creation fails', async () => {
    const store = new MemoryOAuthStore();
    store.failCreate = true;
    const { application } = subject(store);

    await expect(
      application.issue(authority, { redirectUri: REDIRECT_URI }),
    ).rejects.toBeInstanceOf(CalendarGoogleOAuthAuthorizationDependencyError);
    expect(store.deletedReferences).toEqual([SECRET_REFERENCE]);
    expect(store.secrets.size).toBe(0);
  });

  it('compensates verifier material when the secret store returns a malformed opaque reference', async () => {
    const store = new MemoryOAuthStore();
    store.secretReference = 'not-a-uuid';
    const { application } = subject(store);

    await expect(
      application.issue(authority, { redirectUri: REDIRECT_URI }),
    ).rejects.toBeInstanceOf(CalendarGoogleOAuthAuthorizationDependencyError);
    expect(store.deletedReferences).toEqual(['not-a-uuid']);
    expect(store.secrets.size).toBe(0);
    expect(store.records.size).toBe(0);
  });

  it('consumes state once under the exact trusted workspace/user/redirect scope and materializes the verifier internally', async () => {
    const now = vi.fn(() => CREATED_AT);
    const { application } = subject(new MemoryOAuthStore(), now);
    await application.issue(authority, { redirectUri: REDIRECT_URI });
    now.mockReturnValue(CONSUMED_AT);

    await expect(
      application.consume(authority, { state: STATE_ID, redirectUri: REDIRECT_URI }),
    ).resolves.toEqual({ codeVerifier: VERIFIER });
    await expect(
      application.consume(authority, { state: STATE_ID, redirectUri: REDIRECT_URI }),
    ).rejects.toBeInstanceOf(CalendarGoogleOAuthAuthorizationValidationError);
  });

  it('rejects cross-user state substitution without reading verifier material', async () => {
    const store = new MemoryOAuthStore();
    const read = vi.spyOn(store, 'readVerifier');
    const now = vi.fn(() => CREATED_AT);
    const { application } = subject(store, now);
    await application.issue(authority, { redirectUri: REDIRECT_URI });
    now.mockReturnValue(CONSUMED_AT);

    await expect(
      application.consume(
        { workspaceId: WORKSPACE_ID, userId: '55555555-5555-4555-8555-555555555555' },
        { state: STATE_ID, redirectUri: REDIRECT_URI },
      ),
    ).rejects.toBeInstanceOf(CalendarGoogleOAuthAuthorizationValidationError);
    expect(read).not.toHaveBeenCalled();
  });

  it('fails closed when verifier material cannot be read after an accepted one-time state', async () => {
    const store = new MemoryOAuthStore();
    const now = vi.fn(() => CREATED_AT);
    const { application } = subject(store, now);
    await application.issue(authority, { redirectUri: REDIRECT_URI });
    store.failRead = true;
    now.mockReturnValue(CONSUMED_AT);

    await expect(
      application.consume(authority, { state: STATE_ID, redirectUri: REDIRECT_URI }),
    ).rejects.toBeInstanceOf(CalendarGoogleOAuthAuthorizationDependencyError);
  });
});
