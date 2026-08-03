import type {
  ActiveSession,
  ConsumedOAuthTransaction,
} from './auth-security';
import type {
  IdentityProvider,
  MaybePromise,
  ProvisionedAccount,
} from './identity-domain';
import {
  APPLICATION_SESSION_COOKIE_NAME,
  OAUTH_BROWSER_COOKIE_NAME,
  buildFixedWebRedirect,
  parseOAuthCallbackQuery,
  readOpaqueCookie,
  serializeApplicationSessionCookie,
  type OAuthCallbackQuery,
} from './oauth-http-boundary';
import type {
  GoogleAuthorizationCodeInput,
  VerifiedGoogleIdentity,
} from './google-oidc-client';
import type { ProviderIdentityProfile } from './oauth-provider-response';

const CALLBACK_AUTHENTICATION_FAILED = 'OAuth callback authentication failed';
const MAXIMUM_CORRELATION_ID_LENGTH = 128;

/** Consumes one browser- and provider-bound OAuth transaction. */
export interface OAuthTransactionConsumer {
  consume(
    provider: IdentityProvider,
    state: string,
    browserSessionId: string,
  ): Promise<ConsumedOAuthTransaction>;
}

/** Provisions or reuses the account and personal workspace for an identity. */
export interface ExternalIdentityProvisioner {
  signInWithExternalIdentity(input: {
    provider: IdentityProvider;
    providerSubject: string;
    displayName: string;
  }): Promise<ProvisionedAccount>;
}

/** Issues and revokes opaque workspace-scoped application sessions. */
export interface WorkspaceSessionIssuer {
  create(
    userId: string,
    workspaceId: string,
  ): Promise<{ session: ActiveSession; token: string }>;
  revoke(token: string): Promise<void>;
}

/** Verifies one Google authorization-code response. */
export interface GoogleAuthorizationCodeAuthenticator {
  authenticateAuthorizationCode(
    input: GoogleAuthorizationCodeInput,
  ): Promise<VerifiedGoogleIdentity>;
}

/** Retrieves one normalized GitHub identity from an authorization code. */
export interface GitHubAuthorizationCodeAuthenticator {
  authenticateAuthorizationCode(
    authorizationCode: string,
    transaction: ConsumedOAuthTransaction,
  ): Promise<ProviderIdentityProfile>;
}

/** Credential-free audit event emitted for every callback outcome. */
export interface OAuthCallbackAuditEvent {
  provider: IdentityProvider;
  outcome: 'success' | 'failure';
  correlationId: string;
  userId?: string;
  workspaceId?: string;
}

/** Required audit boundary for callback completion. */
export interface OAuthCallbackAuditSink {
  record(event: OAuthCallbackAuditEvent): MaybePromise<void>;
}

/** Fixed provider clients required by the callback application. */
export interface OAuthCallbackProviderClients {
  google: GoogleAuthorizationCodeAuthenticator;
  github: GitHubAuthorizationCodeAuthenticator;
}

/** Construction options for callback orchestration. */
export interface OAuthCallbackApplicationOptions {
  webOrigin: string;
  now?: () => Date;
}

/** Browser redirect and session cookie returned after a successful callback. */
export interface OAuthCallbackSuccessResponse {
  statusCode: 303;
  location: string;
  setCookie: string;
}

function failAuthentication(): never {
  throw new Error(CALLBACK_AUTHENTICATION_FAILED);
}

function requireCorrelationId(value: string): string {
  if (typeof value !== 'string') {
    return failAuthentication();
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAXIMUM_CORRELATION_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return failAuthentication();
  }
  return normalized;
}

function googleDisplayName(identity: VerifiedGoogleIdentity): string {
  return (
    identity.displayName ??
    identity.email ??
    `Google account ${identity.subject.slice(0, 12)}`
  );
}

function providerIdentityInput(
  provider: IdentityProvider,
  identity: VerifiedGoogleIdentity | ProviderIdentityProfile,
): {
  provider: IdentityProvider;
  providerSubject: string;
  displayName: string;
} {
  if (provider === 'google') {
    const googleIdentity = identity as VerifiedGoogleIdentity;
    if (googleIdentity.provider !== 'google') {
      return failAuthentication();
    }
    return {
      provider,
      providerSubject: googleIdentity.subject,
      displayName: googleDisplayName(googleIdentity),
    };
  }

  const githubIdentity = identity as ProviderIdentityProfile;
  if (githubIdentity.provider !== 'github') {
    return failAuthentication();
  }
  return {
    provider,
    providerSubject: githubIdentity.providerSubject,
    displayName: githubIdentity.displayName,
  };
}

/**
 * Coordinates single-use callback state, fixed provider clients, account
 * provisioning, workspace-scoped session issuance, fixed-origin redirect, and
 * credential-free audit records.
 */
export class OAuthCallbackApplication {
  private readonly redirectLocation: string;
  private readonly now: () => Date;

  constructor(
    private readonly transactions: OAuthTransactionConsumer,
    private readonly identities: ExternalIdentityProvisioner,
    private readonly sessions: WorkspaceSessionIssuer,
    private readonly providers: OAuthCallbackProviderClients,
    private readonly audit: OAuthCallbackAuditSink,
    options: OAuthCallbackApplicationOptions,
  ) {
    this.redirectLocation = buildFixedWebRedirect(options.webOrigin);
    this.now = options.now ?? (() => new Date());
  }

  /** Completes one provider callback and returns no provider credential. */
  async completeAuthorization(
    provider: IdentityProvider,
    queryInput: Readonly<Record<string, unknown>>,
    cookieHeader: string | undefined,
    correlationIdValue: string,
  ): Promise<OAuthCallbackSuccessResponse> {
    const correlationId = requireCorrelationId(correlationIdValue);
    let account: ProvisionedAccount | undefined;
    let issuedToken: string | undefined;

    try {
      const query = parseOAuthCallbackQuery(queryInput);
      const browserSessionId = readOpaqueCookie(
        cookieHeader,
        OAUTH_BROWSER_COOKIE_NAME,
      );
      const transaction = await this.transactions.consume(
        provider,
        query.state,
        browserSessionId ?? '',
      );
      if (query.outcome !== 'authorization_code') {
        return failAuthentication();
      }

      const providerIdentity = await this.authenticateProvider(
        provider,
        query,
        transaction,
      );
      account = await this.identities.signInWithExternalIdentity(
        providerIdentityInput(provider, providerIdentity),
      );
      const issued = await this.sessions.create(
        account.user.id,
        account.workspace.id,
      );
      issuedToken = issued.token;
      const setCookie = serializeApplicationSessionCookie(
        issued.token,
        issued.session.expiresAt,
        this.now(),
      );
      await this.audit.record({
        provider,
        outcome: 'success',
        correlationId,
        userId: account.user.id,
        workspaceId: account.workspace.id,
      });
      issuedToken = undefined;
      return {
        statusCode: 303,
        location: this.redirectLocation,
        setCookie,
      };
    } catch {
      if (issuedToken) {
        await this.revokeWithoutThrowing(issuedToken);
      }
      await this.auditWithoutThrowing({
        provider,
        outcome: 'failure',
        correlationId,
        ...(account
          ? {
              userId: account.user.id,
              workspaceId: account.workspace.id,
            }
          : {}),
      });
      return failAuthentication();
    }
  }

  private async authenticateProvider(
    provider: IdentityProvider,
    query: Extract<OAuthCallbackQuery, { outcome: 'authorization_code' }>,
    transaction: ConsumedOAuthTransaction,
  ): Promise<VerifiedGoogleIdentity | ProviderIdentityProfile> {
    if (provider === 'google') {
      if (!transaction.nonce) {
        return failAuthentication();
      }
      return await this.providers.google.authenticateAuthorizationCode({
        code: query.code,
        codeVerifier: transaction.codeVerifier,
        nonce: transaction.nonce,
      });
    }
    return await this.providers.github.authenticateAuthorizationCode(
      query.code,
      transaction,
    );
  }

  private async revokeWithoutThrowing(token: string): Promise<void> {
    try {
      await this.sessions.revoke(token);
    } catch {
      // Callback failure remains authoritative and never exposes session data.
    }
  }

  private async auditWithoutThrowing(
    event: OAuthCallbackAuditEvent,
  ): Promise<void> {
    try {
      await this.audit.record(event);
    } catch {
      // Callback failure remains authoritative and never exposes audit details.
    }
  }
}

export { APPLICATION_SESSION_COOKIE_NAME };
