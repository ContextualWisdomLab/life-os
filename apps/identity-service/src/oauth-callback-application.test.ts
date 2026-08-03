import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryOAuthTransactionRepository,
  InMemorySessionRepository,
  OAuthTransactionService,
  SessionService,
  type ConsumedOAuthTransaction,
} from './auth-security';
import {
  IdentityService,
  InMemoryIdentityRepository,
  type ProvisionedAccount,
} from './identity-domain';
import {
  OAuthCallbackApplication,
  type OAuthCallbackAuditEvent,
  type OAuthCallbackAuditSink,
  type OAuthCallbackProviderClients,
  type WorkspaceSessionIssuer,
} from './oauth-callback-application';
import {
  APPLICATION_SESSION_COOKIE_NAME,
  OAUTH_BROWSER_COOKIE_NAME,
} from './oauth-http-boundary';

const NOW = new Date('2026-08-03T13:00:00.000Z');
const WEB_ORIGIN = 'https://app.example.test';
const GOOGLE_REDIRECT_URI =
  'https://identity.example.test/v1/auth/google/callback';
const GITHUB_REDIRECT_URI =
  'https://identity.example.test/v1/auth/github/callback';
const BROWSER_SESSION_ID = 'browser_binding_value_'.padEnd(43, 'x');
const AUTHORIZATION_CODE = 'provider-authorization-code';
const CORRELATION_ID = 'c1d93eb4-3297-4c30-a96d-6703ee213682';
const SECRET_DIAGNOSTIC = 'provider-token-and-upstream-diagnostic';

function cookieHeader(value = BROWSER_SESSION_ID): string {
  return `${OAUTH_BROWSER_COOKIE_NAME}=${value}`;
}

function sessionToken(setCookie: string): string {
  const match = setCookie.match(
    new RegExp(`^${APPLICATION_SESSION_COOKIE_NAME}=([A-Za-z0-9_-]+);`),
  );
  if (!match?.[1]) {
    throw new Error('Session cookie is missing');
  }
  return match[1];
}

function providerClients(
  overrides: Partial<OAuthCallbackProviderClients> = {},
): OAuthCallbackProviderClients {
  return {
    google: {
      authenticateAuthorizationCode: vi.fn(async () => ({
        provider: 'google',
        subject: 'google-subject-123',
        issuer: 'https://accounts.google.com',
        email: 'person@example.test',
        emailVerified: true,
        displayName: 'Example Person',
      })),
    },
    github: {
      authenticateAuthorizationCode: vi.fn(async () => ({
        provider: 'github',
        providerSubject: '58323117',
        displayName: 'GitHub Person',
        verifiedEmail: 'person@example.test',
      })),
    },
    ...overrides,
  };
}

function createHarness(
  clients = providerClients(),
  auditOverride?: OAuthCallbackAuditSink,
) {
  const transactions = new OAuthTransactionService(
    new InMemoryOAuthTransactionRepository(),
    { now: () => NOW },
  );
  const identityRepository = new InMemoryIdentityRepository();
  const identities = new IdentityService(identityRepository);
  const sessions = new SessionService(new InMemorySessionRepository(), {
    now: () => NOW,
  });
  const auditEvents: OAuthCallbackAuditEvent[] = [];
  const audit =
    auditOverride ??
    ({
      record(event: OAuthCallbackAuditEvent): void {
        auditEvents.push({ ...event });
      },
    } satisfies OAuthCallbackAuditSink);
  const application = new OAuthCallbackApplication(
    transactions,
    identities,
    sessions,
    clients,
    audit,
    { webOrigin: WEB_ORIGIN, now: () => NOW },
  );
  return {
    application,
    transactions,
    identityRepository,
    sessions,
    auditEvents,
  };
}

async function beginGoogle(
  transactions: OAuthTransactionService,
  browserSessionId = BROWSER_SESSION_ID,
) {
  return await transactions.begin('google', {
    browserSessionId,
    redirectUri: GOOGLE_REDIRECT_URI,
  });
}

async function beginGitHub(
  transactions: OAuthTransactionService,
  browserSessionId = BROWSER_SESSION_ID,
) {
  return await transactions.begin('github', {
    browserSessionId,
    redirectUri: GITHUB_REDIRECT_URI,
  });
}

describe('OAuthCallbackApplication', () => {
  it('verifies Google, provisions one account, issues one session, audits, and redirects to the fixed origin', async () => {
    let observedGoogleInput:
      | { code: string; codeVerifier: string; nonce: string }
      | undefined;
    const clients = providerClients({
      google: {
        authenticateAuthorizationCode: vi.fn(async (input) => {
          observedGoogleInput = input;
          return {
            provider: 'google',
            subject: 'google-subject-123',
            issuer: 'https://accounts.google.com',
            email: 'person@example.test',
            emailVerified: true,
            displayName: 'Example Person',
          };
        }),
      },
    });
    const harness = createHarness(clients);
    const transaction = await beginGoogle(harness.transactions);

    const response = await harness.application.completeAuthorization(
      'google',
      { code: AUTHORIZATION_CODE, state: transaction.state },
      cookieHeader(),
      CORRELATION_ID,
    );

    expect(response).toEqual({
      statusCode: 303,
      location: 'https://app.example.test/auth/complete',
      setCookie: expect.stringContaining(
        '; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax',
      ),
    });
    expect(observedGoogleInput).toMatchObject({
      code: AUTHORIZATION_CODE,
      nonce: transaction.nonce,
    });
    expect(observedGoogleInput?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

    const activeSession = await harness.sessions.authenticate(
      sessionToken(response.setCookie),
    );
    const account = await harness.identityRepository.findByExternalIdentity(
      'google',
      'google-subject-123',
    );
    expect(account).toBeDefined();
    expect(activeSession).toMatchObject({
      userId: account?.user.id,
      workspaceId: account?.workspace.id,
    });
    expect(harness.auditEvents).toEqual([
      {
        provider: 'google',
        outcome: 'success',
        correlationId: CORRELATION_ID,
        userId: account?.user.id,
        workspaceId: account?.workspace.id,
      },
    ]);
    expect(JSON.stringify(harness.auditEvents)).not.toContain(
      AUTHORIZATION_CODE,
    );
    expect(JSON.stringify(response)).not.toContain('google-subject-123');
  });

  it('uses the consumed GitHub transaction and falls back to the normalized login display name', async () => {
    let observedTransaction: ConsumedOAuthTransaction | undefined;
    const clients = providerClients({
      github: {
        authenticateAuthorizationCode: vi.fn(async (_code, transaction) => {
          observedTransaction = transaction;
          return {
            provider: 'github',
            providerSubject: '9007199254740993',
            displayName: 'large-subject',
          };
        }),
      },
    });
    const harness = createHarness(clients);
    const transaction = await beginGitHub(harness.transactions);

    const response = await harness.application.completeAuthorization(
      'github',
      { code: AUTHORIZATION_CODE, state: transaction.state },
      cookieHeader(),
      CORRELATION_ID,
    );

    expect(observedTransaction).toMatchObject({
      provider: 'github',
      redirectUri: GITHUB_REDIRECT_URI,
    });
    expect(observedTransaction).not.toHaveProperty('nonce');
    const account = await harness.identityRepository.findByExternalIdentity(
      'github',
      '9007199254740993',
    );
    expect(account?.user.displayName).toBe('large-subject');
    await expect(
      harness.sessions.authenticate(sessionToken(response.setCookie)),
    ).resolves.toMatchObject({
      userId: account?.user.id,
      workspaceId: account?.workspace.id,
    });
  });

  it('consumes provider-error state exactly once without contacting a provider', async () => {
    const clients = providerClients();
    const harness = createHarness(clients);
    const transaction = await beginGitHub(harness.transactions);

    await expect(
      harness.application.completeAuthorization(
        'github',
        { error: 'access_denied', state: transaction.state },
        cookieHeader(),
        CORRELATION_ID,
      ),
    ).rejects.toThrow('OAuth callback authentication failed');
    await expect(
      harness.application.completeAuthorization(
        'github',
        { code: AUTHORIZATION_CODE, state: transaction.state },
        cookieHeader(),
        CORRELATION_ID,
      ),
    ).rejects.toThrow('OAuth callback authentication failed');

    expect(
      clients.github.authenticateAuthorizationCode,
    ).not.toHaveBeenCalled();
    expect(harness.auditEvents).toEqual([
      {
        provider: 'github',
        outcome: 'failure',
        correlationId: CORRELATION_ID,
      },
      {
        provider: 'github',
        outcome: 'failure',
        correlationId: CORRELATION_ID,
      },
    ]);
  });

  it.each([
    ['cross-browser use', 'google', 'google', 'another_browser_binding_value_x'],
    ['provider mismatch', 'google', 'github', BROWSER_SESSION_ID],
  ] as const)(
    'fails closed for %s before provider access',
    async (_name, transactionProvider, callbackProvider, browserSessionId) => {
      const clients = providerClients();
      const harness = createHarness(clients);
      const transaction =
        transactionProvider === 'google'
          ? await beginGoogle(harness.transactions)
          : await beginGitHub(harness.transactions);

      await expect(
        harness.application.completeAuthorization(
          callbackProvider,
          { code: AUTHORIZATION_CODE, state: transaction.state },
          cookieHeader(browserSessionId),
          CORRELATION_ID,
        ),
      ).rejects.toThrow('OAuth callback authentication failed');

      expect(
        clients.google.authenticateAuthorizationCode,
      ).not.toHaveBeenCalled();
      expect(
        clients.github.authenticateAuthorizationCode,
      ).not.toHaveBeenCalled();
    },
  );

  it('maps provider diagnostics to one generic error and credential-free failure audit', async () => {
    const clients = providerClients({
      google: {
        authenticateAuthorizationCode: vi.fn(async () => {
          throw new Error(SECRET_DIAGNOSTIC);
        }),
      },
    });
    const harness = createHarness(clients);
    const transaction = await beginGoogle(harness.transactions);

    const failure = await harness.application
      .completeAuthorization(
        'google',
        { code: AUTHORIZATION_CODE, state: transaction.state },
        cookieHeader(),
        CORRELATION_ID,
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      'OAuth callback authentication failed',
    );
    expect((failure as Error).message).not.toContain(SECRET_DIAGNOSTIC);
    expect(JSON.stringify(harness.auditEvents)).not.toContain(
      SECRET_DIAGNOSTIC,
    );
    expect(JSON.stringify(harness.auditEvents)).not.toContain(
      transaction.state,
    );
    expect(harness.auditEvents).toEqual([
      {
        provider: 'google',
        outcome: 'failure',
        correlationId: CORRELATION_ID,
      },
    ]);
  });

  it('revokes an issued session when the success audit cannot be recorded', async () => {
    const account: ProvisionedAccount = {
      user: {
        id: 'b16f9ab0-97e2-48f7-9870-fbf1753081e2',
        displayName: 'Example Person',
        createdAt: NOW.toISOString(),
      },
      externalIdentity: {
        id: '10419f2e-e66f-483f-b0ea-947fd392b300',
        userId: 'b16f9ab0-97e2-48f7-9870-fbf1753081e2',
        provider: 'google',
        providerSubject: 'google-subject-123',
        createdAt: NOW.toISOString(),
      },
      workspace: {
        id: '4e354c1c-c540-4b66-b6a3-af7e87b547a9',
        ownerUserId: 'b16f9ab0-97e2-48f7-9870-fbf1753081e2',
        name: "Example Person's workspace",
        kind: 'personal',
        createdAt: NOW.toISOString(),
      },
    };
    const issuedToken = 'issued_session_token_value';
    const sessions: WorkspaceSessionIssuer = {
      create: vi.fn(async () => ({
        token: issuedToken,
        session: {
          id: '0f984d82-4e08-4593-87ec-816fd72eb6fe',
          userId: account.user.id,
          workspaceId: account.workspace.id,
          createdAt: NOW.toISOString(),
          expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
        },
      })),
      revoke: vi.fn(async () => {
        throw new Error('revocation diagnostic');
      }),
    };
    const application = new OAuthCallbackApplication(
      {
        consume: vi.fn(async () => ({
          id: '67a6772e-6392-4406-aa28-93330a6f36af',
          provider: 'google',
          codeVerifier: 'v'.repeat(64),
          redirectUri: GOOGLE_REDIRECT_URI,
          nonce: 'n'.repeat(43),
        })),
      },
      { signInWithExternalIdentity: vi.fn(async () => account) },
      sessions,
      providerClients(),
      {
        record: vi.fn(async (event) => {
          if (event.outcome === 'success') {
            throw new Error('audit storage diagnostic');
          }
        }),
      },
      { webOrigin: WEB_ORIGIN, now: () => NOW },
    );

    await expect(
      application.completeAuthorization(
        'google',
        { code: AUTHORIZATION_CODE, state: 'state-value' },
        cookieHeader(),
        CORRELATION_ID,
      ),
    ).rejects.toThrow('OAuth callback authentication failed');
    expect(sessions.revoke).toHaveBeenCalledWith(issuedToken);
  });

  it('rejects malformed callback input and correlation identifiers without leaking details', async () => {
    const harness = createHarness();

    await expect(
      harness.application.completeAuthorization(
        'google',
        { code: [AUTHORIZATION_CODE], state: 'state-value' },
        cookieHeader(),
        CORRELATION_ID,
      ),
    ).rejects.toThrow('OAuth callback authentication failed');
    await expect(
      harness.application.completeAuthorization(
        'google',
        { code: AUTHORIZATION_CODE, state: 'state-value' },
        cookieHeader(),
        'bad\ncorrelation',
      ),
    ).rejects.toThrow('OAuth callback authentication failed');
  });
});
