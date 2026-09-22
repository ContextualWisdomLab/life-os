import {
  requireIdentityProvider,
  type ConsumedOAuthTransaction,
} from './auth-security';
import type { IdentityProvider } from './identity-domain';
import { requireSafeRedirectUri } from './oauth-redirect-uri';

const TOKEN_ENDPOINTS: Record<IdentityProvider, string> = {
  google: 'https://oauth2.googleapis.com/token',
  github: 'https://github.com/login/oauth/access_token',
};
const AUTHORIZATION_CODE_PATTERN = /^[\x20-\x7e]+$/;
const PKCE_CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

function requireText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function requireAuthorizationCode(value: string): string {
  if (
    typeof value !== 'string' ||
    !AUTHORIZATION_CODE_PATTERN.test(value) ||
    Buffer.byteLength(value, 'utf8') > 2 * 1024
  ) {
    throw new Error('OAuth authorization code is required');
  }
  return value;
}

function requirePkceCodeVerifier(value: string): string {
  if (typeof value !== 'string' || !PKCE_CODE_VERIFIER_PATTERN.test(value)) {
    throw new Error('OAuth PKCE verifier is invalid');
  }
  return value;
}

export interface OAuthTokenExchangeRequest {
  url: string;
  method: 'POST';
  headers: {
    accept: 'application/json';
    'content-type': 'application/x-www-form-urlencoded';
  };
  body: string;
}

export function buildTokenExchangeRequest(
  providerValue: IdentityProvider,
  configuration: { clientId: string; clientSecret: string; redirectUri: string },
  authorizationCode: string,
  transaction: ConsumedOAuthTransaction,
): OAuthTokenExchangeRequest {
  const provider = requireIdentityProvider(providerValue);
  if (transaction.provider !== provider) {
    throw new Error('OAuth transaction provider mismatch');
  }

  const clientId = requireText(configuration.clientId, 'OAuth client ID is required');
  const clientSecret = requireText(
    configuration.clientSecret,
    'OAuth client secret is required',
  );
  const redirectUri = requireSafeRedirectUri(configuration.redirectUri);
  if (transaction.redirectUri !== redirectUri) {
    throw new Error('OAuth transaction redirect URI mismatch');
  }

  const code = requireAuthorizationCode(authorizationCode);
  const codeVerifier = requirePkceCodeVerifier(transaction.codeVerifier);

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  if (provider === 'google') {
    body.set('grant_type', 'authorization_code');
  }

  return {
    url: TOKEN_ENDPOINTS[provider],
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  };
}
