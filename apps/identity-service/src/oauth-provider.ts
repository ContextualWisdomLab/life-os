import type { OAuthTransactionStart } from './auth-security';
import type { IdentityProvider } from './identity-domain';

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

export function requireSafeRedirectUri(value: string): string {
  let redirectUri: URL;
  try {
    redirectUri = new URL(value);
  } catch {
    throw new Error('OAuth redirect URI is invalid');
  }

  const isLoopback =
    redirectUri.hostname === 'localhost' ||
    redirectUri.hostname === '127.0.0.1' ||
    redirectUri.hostname === '[::1]';
  const isAllowedProtocol =
    redirectUri.protocol === 'https:' || (redirectUri.protocol === 'http:' && isLoopback);
  if (!isAllowedProtocol) {
    throw new Error('OAuth redirect URI must use HTTPS except on loopback hosts');
  }
  if (redirectUri.username || redirectUri.password || redirectUri.hash) {
    throw new Error('OAuth redirect URI contains unsupported components');
  }
  return redirectUri.toString();
}

export function buildAuthorizationUrl(
  provider: IdentityProvider,
  configuration: { clientId: string; redirectUri: string },
  transaction: OAuthTransactionStart,
): string {
  if (transaction.provider !== provider) {
    throw new Error('OAuth transaction provider mismatch');
  }

  const authorizationUrl = new URL(AUTHORIZATION_ENDPOINTS[provider]);
  authorizationUrl.searchParams.set('client_id', requireClientId(configuration.clientId));
  authorizationUrl.searchParams.set(
    'redirect_uri',
    requireSafeRedirectUri(configuration.redirectUri),
  );
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
