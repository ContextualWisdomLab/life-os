import type { ConsumedOAuthTransaction } from './auth-security';
import {
  BoundedOAuthProviderHttpClient,
  type OAuthProviderHttpRequest,
  type OAuthProviderHttpResult,
} from './oauth-provider-http-client';
import {
  buildGitHubIdentityRequests,
  normalizeGitHubIdentity,
  parseOAuthTokenResponse,
  type ProviderIdentityProfile,
} from './oauth-provider-response';
import { requireSafeRedirectUri } from './oauth-redirect-uri';
import { buildTokenExchangeRequest } from './oauth-token-exchange';

const GITHUB_AUTHENTICATION_FAILED = 'GitHub OAuth authentication failed';
const MAXIMUM_CONFIGURATION_TEXT_LENGTH = 4_096;
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 64 * 1_024;

/** Minimal provider transport required by the GitHub OAuth client. */
export interface OAuthProviderRequestExecutor {
  execute(request: OAuthProviderHttpRequest): Promise<OAuthProviderHttpResult>;
}

/** Construction options for the fixed-endpoint GitHub OAuth client. */
export interface GitHubOAuthClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  httpClient?: OAuthProviderRequestExecutor;
}

function failAuthentication(): never {
  throw new Error(GITHUB_AUTHENTICATION_FAILED);
}

function requireConfigurationText(value: string, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAXIMUM_CONFIGURATION_TEXT_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(message);
  }
  return normalized;
}

function parseGitHubResponse(
  response: OAuthProviderHttpResult,
  expectedShape: 'object' | 'array',
): unknown {
  if (
    !response ||
    typeof response !== 'object' ||
    !Number.isInteger(response.status) ||
    response.status < 200 ||
    response.status >= 300 ||
    typeof response.contentType !== 'string' ||
    response.contentType.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json' ||
    typeof response.body !== 'string' ||
    response.body.length === 0 ||
    Buffer.byteLength(response.body, 'utf8') > MAXIMUM_PROVIDER_RESPONSE_BYTES
  ) {
    return failAuthentication();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    return failAuthentication();
  }

  if (
    (expectedShape === 'object' &&
      (!payload || typeof payload !== 'object' || Array.isArray(payload))) ||
    (expectedShape === 'array' && !Array.isArray(payload))
  ) {
    return failAuthentication();
  }
  return payload;
}

/**
 * Exchanges a GitHub authorization code at the fixed token endpoint and
 * retrieves the bounded user and verified-email profiles without exposing the
 * provider access token across the identity boundary.
 */
export class GitHubOAuthClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly httpClient: OAuthProviderRequestExecutor;

  constructor(options: GitHubOAuthClientOptions) {
    this.clientId = requireConfigurationText(
      options.clientId,
      'GitHub OAuth client ID is invalid',
    );
    this.clientSecret = requireConfigurationText(
      options.clientSecret,
      'GitHub OAuth client secret is invalid',
    );
    this.redirectUri = requireSafeRedirectUri(options.redirectUri);
    this.httpClient =
      options.httpClient ?? new BoundedOAuthProviderHttpClient();
  }

  /** Returns only the normalized GitHub identity required for provisioning. */
  async authenticateAuthorizationCode(
    authorizationCode: string,
    transaction: ConsumedOAuthTransaction,
  ): Promise<ProviderIdentityProfile> {
    try {
      const tokenRequest = buildTokenExchangeRequest(
        'github',
        {
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          redirectUri: this.redirectUri,
        },
        authorizationCode,
        transaction,
      );
      const tokenResponse = await this.httpClient.execute(tokenRequest);
      const token = parseOAuthTokenResponse('github', tokenResponse);
      const requests = buildGitHubIdentityRequests(token.accessToken);
      const userResponse = await this.httpClient.execute(requests.user);
      const userPayload = parseGitHubResponse(userResponse, 'object');
      const emailResponse = await this.httpClient.execute(requests.emails);
      const emailPayload = parseGitHubResponse(emailResponse, 'array');
      return Object.freeze(normalizeGitHubIdentity(userPayload, emailPayload));
    } catch {
      return failAuthentication();
    }
  }
}
