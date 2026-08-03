import {
  requireIdentityProvider,
  type OAuthTransactionStart,
} from './auth-security';
import type { IdentityProvider } from './identity-domain';
import { requireSafeRedirectUri } from './oauth-redirect-uri';

const AUTHORIZATION_ENDPOINTS: Record<IdentityProvider, string> = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  github: 'https://github.com/login/oauth/authorize',
};

const IDENTITY_SCOPES: Record<IdentityProvider, string> = {
  google: 'openid email profile',
  github: 'read:user user:email',
};

function requireClientId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('OAuth client ID is required');
  }
  return normalized;
}

export function buildAuthorizationUrl(
  providerValue: IdentityProvider,
  configuration: { clientId: string; redirectUri: string },
  transaction: OAuthTransactionStart,
): string {
  const provider = requireIdentityProvider(providerValue);
  if (transaction.provider !== provider) {
    throw new Error('OAuth transaction provider mismatch');
  }

  const redirectUri = requireSafeRedirectUri(configuration.redirectUri);
  if (transaction.redirectUri !== redirectUri) {
    throw new Error('OAuth transaction redirect URI mismatch');
  }

  const authorizationUrl = new URL(AUTHORIZATION_ENDPOINTS[provider]);
  authorizationUrl.searchParams.set('client_id', requireClientId(configuration.clientId));
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('scope', IDENTITY_SCOPES[provider]);
  authorizationUrl.searchParams.set('state', transaction.state);
  authorizationUrl.searchParams.set('code_challenge', transaction.codeChallenge);
  authorizationUrl.searchParams.set(
    'code_challenge_method',
    transaction.codeChallengeMethod,
  );

  if (provider === 'google') {
    if (!transaction.nonce) {
      throw new Error('Google OAuth transaction nonce is required');
    }
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('nonce', transaction.nonce);
  }

  return authorizationUrl.toString();
}
