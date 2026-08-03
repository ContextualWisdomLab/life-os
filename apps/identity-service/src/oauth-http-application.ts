import {
  OAuthTransactionService,
  SessionService,
  type ActiveSession,
} from './auth-security';
import type { IdentityProvider } from './identity-domain';
import {
  APPLICATION_SESSION_COOKIE_NAME,
  OAUTH_BROWSER_COOKIE_NAME,
  buildFixedWebRedirect,
  clearApplicationSessionCookie,
  createOAuthBrowserBinding,
  readOpaqueCookie,
  toSessionView,
} from './oauth-http-boundary';
import { buildAuthorizationUrl } from './oauth-provider';
import { requireSafeRedirectUri } from './oauth-redirect-uri';

export interface OAuthProviderStartConfiguration {
  clientId: string;
  redirectUri: string;
}

export interface OAuthHttpApplicationConfiguration {
  providers: Readonly<Record<IdentityProvider, OAuthProviderStartConfiguration>>;
  webOrigin: string;
}

export interface AuthorizationStartResponse {
  statusCode: 303;
  location: string;
  setCookie?: string;
}

export interface SessionIntrospectionResponse {
  statusCode: 200;
  body: ReturnType<typeof toSessionView>;
}

export interface LogoutResponse {
  statusCode: 204;
  setCookie: string;
}

function requireProviderConfiguration(
  provider: IdentityProvider,
  configuration: OAuthHttpApplicationConfiguration,
): OAuthProviderStartConfiguration {
  const providerConfiguration = configuration.providers[provider];
  const clientId = providerConfiguration.clientId.trim();
  if (!clientId) {
    throw new Error('OAuth client ID is required');
  }
  return {
    clientId,
    redirectUri: requireSafeRedirectUri(providerConfiguration.redirectUri),
  };
}

/**
 * Coordinates the browser-facing authorization start, session lookup, and logout boundaries.
 * Provider callbacks are intentionally delegated to the subsequent callback-orchestration slice.
 */
export class OAuthHttpApplication {
  private readonly fixedWebRedirect: string;

  constructor(
    private readonly transactions: OAuthTransactionService,
    private readonly sessions: SessionService,
    private readonly configuration: OAuthHttpApplicationConfiguration,
  ) {
    this.fixedWebRedirect = buildFixedWebRedirect(configuration.webOrigin);
    requireProviderConfiguration('google', configuration);
    requireProviderConfiguration('github', configuration);
  }

  /**
   * Starts a provider-bound OAuth transaction and creates a browser-binding cookie when absent.
   */
  async beginAuthorization(
    provider: IdentityProvider,
    cookieHeader: string | undefined,
  ): Promise<AuthorizationStartResponse> {
    const existingBrowserSessionId = readOpaqueCookie(
      cookieHeader,
      OAUTH_BROWSER_COOKIE_NAME,
    );
    const browserBinding = existingBrowserSessionId
      ? { browserSessionId: existingBrowserSessionId }
      : createOAuthBrowserBinding();
    const providerConfiguration = requireProviderConfiguration(provider, this.configuration);
    const transaction = await this.transactions.begin(provider, {
      browserSessionId: browserBinding.browserSessionId,
      redirectUri: providerConfiguration.redirectUri,
    });

    return {
      statusCode: 303,
      location: buildAuthorizationUrl(provider, providerConfiguration, transaction),
      ...('setCookie' in browserBinding ? { setCookie: browserBinding.setCookie } : {}),
    };
  }

  /**
   * Authenticates the opaque server-side session cookie and returns no bearer material.
   */
  async introspectSession(
    cookieHeader: string | undefined,
  ): Promise<SessionIntrospectionResponse> {
    const token = readOpaqueCookie(cookieHeader, APPLICATION_SESSION_COOKIE_NAME);
    const session = await this.sessions.authenticate(token ?? '');
    return { statusCode: 200, body: toSessionView(session) };
  }

  /**
   * Revokes an existing session when present and always returns an idempotent cookie clear.
   */
  async logout(cookieHeader: string | undefined): Promise<LogoutResponse> {
    const token = readOpaqueCookie(cookieHeader, APPLICATION_SESSION_COOKIE_NAME);
    await this.sessions.revoke(token ?? '');
    return {
      statusCode: 204,
      setCookie: clearApplicationSessionCookie(),
    };
  }

  /**
   * Returns the configured fixed browser destination used after successful provider callbacks.
   */
  postLoginRedirect(): string {
    return this.fixedWebRedirect;
  }

  /**
   * Converts a session to the public response shape for callback orchestration.
   */
  sessionView(session: ActiveSession): ReturnType<typeof toSessionView> {
    return toSessionView(session);
  }
}
