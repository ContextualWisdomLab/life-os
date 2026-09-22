import { describe, expect, it } from 'vitest';
import { validateVerifiedGoogleIdentity } from '../oauth-provider-response';

const NOW = new Date('2026-09-21T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function verifiedToken(nonce: string) {
  return {
    signatureVerified: true as const,
    claims: {
      iss: 'https://accounts.google.com',
      sub: '123456789012345678901',
      aud: 'google-client-id',
      exp: NOW_SECONDS + 600,
      iat: NOW_SECONDS - 10,
      nonce,
      email: 'user@example.com',
      email_verified: true,
      name: 'Example User',
    },
  };
}

describe('OIDC nonce exact-match authority', () => {
  it(
    'rejects a signature-verified nonce claim whose bytes differ only by surrounding whitespace',
    () => {
      expect(() =>
        validateVerifiedGoogleIdentity(verifiedToken(' expected-nonce '), {
          clientId: 'google-client-id',
          nonce: 'expected-nonce',
          now: NOW,
        }),
      ).toThrowError('Google ID token is invalid');
    },
  );

  it(
    'rejects a stored expected nonce that is recanonicalized before comparison',
    () => {
      expect(() =>
        validateVerifiedGoogleIdentity(verifiedToken('expected-nonce'), {
          clientId: 'google-client-id',
          nonce: ' expected-nonce ',
          now: NOW,
        }),
      ).toThrowError('Google ID token is invalid');
    },
  );
});
