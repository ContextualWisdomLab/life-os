import type { ConsumedOAuthTransaction } from './auth-security';
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
const CALLBACK_SERVICE_UNAVAILABLE = 'OAuth callback service is unavailable';
const MAXIMUM_CORRELATION_ID_LENGTH = 128;
const EXPECTED_TRANSACTION_FAILURES = new Set([
  'OAuth transaction is invalid or no longer active',
  'Identifier must be an opaque non-numeric string',
  'Unsupported identity provider',
]);

/** Credential-free failure raised for invalid or rejected callback input. */
export class OAuthCallbackAuthenticationError extends Error {
  constructor() {
    super(CALLBACK_AUTHENTICATION_FAILED);
    this.name = 'OAuthCallbackAuthenticationError';
  }
}

/** Credential-free failure raised when callback infrastructure is unavailable. */
export class OAuthCallbackServiceError extends Error {
  constructor() {
    super(CALLBACK_SERVICE_UNAVAILABLE);
    this.name = 'OAuthCallbackServiceError';
  }
}

/** Consumes one browser- and provider-bound OAuth transaction. */
export interface OAuthTransactionConsumer {
  consume(
    identityProvider: IdentityProvider,
    state: string,
    browserSessionId: string,
  ): Promise<ConsumedOAuthTransaction>;
}

/** Provisions or reuses the account and personal workspace for an identity. */
export interface ExternalIdentityProvisioner {
  signInWithExternalIdentity(identityInput: {
    identityProvider: IdentityProvider;
    providerSubject: string;
    displayName: string;
  }): Promise<ProvisionedAccount>;
}

/** Minimum session metadata needed to issue one browser cookie. */
export interface WorkspaceIssuedSession {
  expiresAt: string;
}

/** Issues and revokes opaque workspace-scoped application sessions. */
export interface WorkspaceSessionIssuer {
  create(
    userAccountId: string,
    identityWorkspaceId: string,
  ): Promise<{ session: WorkspaceIssuedSession; token: string }>;
  revoke(sessionToken: string): Promise<void>;
}

/** Verifies one Google authorization-code response. */
export interface GoogleAuthorizationCodeAuthenticator {
  authenticateAuthorizationCode(
    authorizationInput: GoogleAuthorizationCodeInput,
  ): Promise<VerifiedGoogleIdentity>;
}

/** Retrieves one normalized GitHub identity from an authorization code. */
export interface GitHubAuthorizationCodeAuthenticator {
  authenticateAuthorizationCode(
    authorizationCode: string,
    consumedTransaction: ConsumedOAuthTransaction,
  ): Promise<ProviderIdentityProfile>;
}

/** Credential-free audit event emitted for every callback outcome. */
export interface OAuthCallbackAuditEvent {
  identityProvider: IdentityProvider;
  callbackOutcome: 'success' | 'failure';
  correlationId: string;
  userAccountId?: string;
  identityWorkspaceId?: string;
}

/** Required audit boundary for callback completion. */
export interface OAuthCallbackAuditSink {
  record(auditEvent: OAuthCallbackAuditEvent): MaybePromise<void>;
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
  throw new OAuthCallbackAuthenticationError();
}

function failService(): never {
  throw new OAuthCallbackServiceError();
}

function requireCorrelationId(correlationIdValue: string): string {
  if (typeof correlationIdValue !== 'string') {
    return failAuthentication();
  }
  const normalizedCorrelationId = correlationIdValue.trim();
  if (
    !normalizedCorrelationId ||
    normalizedCorrelationId.length > MAXIMUM_CORRELATION_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalizedCorrelationId)
  ) {
    return failAuthentication();
  }
  return normalizedCorrelationId;
}

function isExpectedTransactionFailure(error: unknown): boolean {
  return (
    error instanceof Error && EXPECTED_TRANSACTION_FAILURES.has(error.message)
  );
}

function googleDisplayName(googleIdentity: VerifiedGoogleIdentity): string {
  return (
    googleIdentity.displayName ??
    googleIdentity.email ??
    `Google account ${googleIdentity.subject.slice(0, 12)}`
  );
}

function providerIdentityInput(
  identityProvider: IdentityProvider,
  providerIdentity: VerifiedGoogleIdentity | ProviderIdentityProfile,
): {
  identityProvider: IdentityProvider;
  providerSubject: string;
  displayName: string;
} {
  if (identityProvider === 'google') {
    const googleIdentity = providerIdentity as VerifiedGoogleIdentity;
    if (googleIdentity.provider !== 'google') {
      return failAuthentication();
    }
    return {
      identityProvider,
      providerSubject: googleIdentity.subject,
      displayName: googleDisplayName(googleIdentity),
    };
  }

  const githubIdentity = providerIdentity as ProviderIdentityProfile;
  if (githubIdentity.provider !== 'github') {
    return failAuthentication();
  }
  return {
    identityProvider,
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
  private readonly currentTime: () => Date;

  constructor(
    private readonly transactionConsumer: OAuthTransactionConsumer,
    private readonly identityProvisioner: ExternalIdentityProvisioner,
    private readonly sessionIssuer: WorkspaceSessionIssuer,
    private readonly providerClients: OAuthCallbackProviderClients,
    private readonly auditSink: OAuthCallbackAuditSink,
    applicationOptions: OAuthCallbackApplicationOptions,
  ) {
    this.redirectLocation = buildFixedWebRedirect(applicationOptions.webOrigin);
    this.currentTime = applicationOptions.now ?? (() => new Date());
  }

  /** Completes one provider callback and returns no provider credential. */
  async completeAuthorization(
    identityProvider: IdentityProvider,
    queryInput: Readonly<Record<string, unknown>>,
    cookieHeader: string | undefined,
    correlationIdValue: string,
  ): Promise<OAuthCallbackSuccessResponse> {
    const correlationId = requireCorrelationId(correlationIdValue);
    let provisionedAccount: ProvisionedAccount | undefined;
    let issuedSessionToken: string | undefined;

    try {
      const callbackQuery = this.requireCallbackInput(queryInput, cookieHeader);
      const browserSessionId = this.requireBrowserSessionId(cookieHeader);
      const consumedTransaction = await this.consumeTransaction(
        identityProvider,
        callbackQuery.state,
        browserSessionId,
      );
      if (callbackQuery.outcome !== 'authorization_code') {
        return failAuthentication();
      }

      const providerIdentity = await this.authenticateProvider(
        identityProvider,
        callbackQuery,
        consumedTransaction,
      );
      provisionedAccount = await this.identityProvisioner.signInWithExternalIdentity(
        providerIdentityInput(identityProvider, providerIdentity),
      );
      const issuedSession = await this.sessionIssuer.create(
        provisionedAccount.userAccount.userAccountId,
        provisionedAccount.identityWorkspace.identityWorkspaceId,
      );
      issuedSessionToken = issuedSession.token;
      const setCookie = serializeApplicationSessionCookie(
        issuedSession.token,
        issuedSession.session.expiresAt,
        this.currentTime(),
      );
      await this.auditWithoutThrowing({
        identityProvider,
        callbackOutcome: 'success',
        correlationId,
        userAccountId: provisionedAccount.userAccount.userAccountId,
        identityWorkspaceId:
          provisionedAccount.identityWorkspace.identityWorkspaceId,
      });
      issuedSessionToken = undefined;
      return {
        statusCode: 303,
        location: this.redirectLocation,
        setCookie,
      };
    } catch (error) {
      if (issuedSessionToken) {
        await this.revokeWithoutThrowing(issuedSessionToken);
      }
      await this.auditWithoutThrowing({
        identityProvider,
        callbackOutcome: 'failure',
        correlationId,
        ...(provisionedAccount
          ? {
              userAccountId: provisionedAccount.userAccount.userAccountId,
              identityWorkspaceId:
                provisionedAccount.identityWorkspace.identityWorkspaceId,
            }
          : {}),
      });
      if (error instanceof OAuthCallbackAuthenticationError) {
        throw error;
      }
      return failService();
    }
  }

  private requireCallbackInput(
    queryInput: Readonly<Record<string, unknown>>,
    cookieHeader: string | undefined,
  ): OAuthCallbackQuery {
    try {
      const callbackQuery = parseOAuthCallbackQuery(queryInput);
      this.requireBrowserSessionId(cookieHeader);
      return callbackQuery;
    } catch {
      return failAuthentication();
    }
  }

  private requireBrowserSessionId(cookieHeader: string | undefined): string {
    try {
      return (
        readOpaqueCookie(cookieHeader, OAUTH_BROWSER_COOKIE_NAME) ??
        failAuthentication()
      );
    } catch (error) {
      if (error instanceof OAuthCallbackAuthenticationError) {
        throw error;
      }
      return failAuthentication();
    }
  }

  private async consumeTransaction(
    identityProvider: IdentityProvider,
    state: string,
    browserSessionId: string,
  ): Promise<ConsumedOAuthTransaction> {
    try {
      return await this.transactionConsumer.consume(
        identityProvider,
        state,
        browserSessionId,
      );
    } catch (error) {
      if (isExpectedTransactionFailure(error)) {
        return failAuthentication();
      }
      throw error;
    }
  }

  private async authenticateProvider(
    identityProvider: IdentityProvider,
    callbackQuery: Extract<OAuthCallbackQuery, { outcome: 'authorization_code' }>,
    consumedTransaction: ConsumedOAuthTransaction,
  ): Promise<VerifiedGoogleIdentity | ProviderIdentityProfile> {
    if (identityProvider === 'google') {
      if (!consumedTransaction.nonce) {
        return failAuthentication();
      }
      return await this.providerClients.google.authenticateAuthorizationCode({
        code: callbackQuery.code,
        codeVerifier: consumedTransaction.codeVerifier,
        nonce: consumedTransaction.nonce,
      });
    }
    return await this.providerClients.github.authenticateAuthorizationCode(
      callbackQuery.code,
      consumedTransaction,
    );
  }

  private async revokeWithoutThrowing(sessionToken: string): Promise<void> {
    try {
      await this.sessionIssuer.revoke(sessionToken);
    } catch {
      // Callback failure remains authoritative and never exposes session data.
    }
  }

  private async auditWithoutThrowing(
    auditEvent: OAuthCallbackAuditEvent,
  ): Promise<void> {
    try {
      await this.auditSink.record(auditEvent);
    } catch {
      // Authentication remains authoritative and never exposes audit details.
    }
  }
}

export { APPLICATION_SESSION_COOKIE_NAME };
