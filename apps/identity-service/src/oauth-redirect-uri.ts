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
    redirectUri.hostname === '[::1]' ||
    redirectUri.hostname === '::1';
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
