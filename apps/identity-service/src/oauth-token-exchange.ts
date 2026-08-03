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

function requireText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
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

  const code = requireText(authorizationCode, 'OAuth authorization code is required');
  const codeVerifier = requireText(
    transaction.codeVerifier,
    'OAuth PKCE verifier is required',
  );

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
