import { describe, expect, it } from 'vitest';
import type { ConsumedOAuthTransaction } from './auth-security';
import {
  OAUTH_BROWSER_COOKIE_NAME,
  parseOAuthCallbackQuery,
  readOpaqueCookie,
} from './oauth-http-boundary';
import { buildTokenExchangeRequest } from './oauth-token-exchange';

const REDIRECT_URI = 'https://identity.example.com/v1/auth/google/callback';
const CODE_VERIFIER = 'A'.repeat(43);

const TRANSACTION = Object.freeze({
  id: 'opaque_transaction',
  provider: 'google',
  codeVerifier: CODE_VERIFIER,
  redirectUri: REDIRECT_URI,
  nonce: 'opaque_nonce',
} satisfies ConsumedOAuthTransaction);

function tokenExchange(code: string, transaction = TRANSACTION): URLSearchParams {
  const request = buildTokenExchangeRequest(
    'google',
    {
      clientId: 'google-client',
      clientSecret: 'google-client-secret',
      redirectUri: REDIRECT_URI,
    },
    code,
    transaction,
  );
  return new URLSearchParams(request.body);
}

describe('OAuth callback canonical evidence', () => {
  it('preserves the provider-owned authorization code exactly through callback parsing and token exchange', () => {
    const code = ' provider-owned-code ';
    const parsed = parseOAuthCallbackQuery({
      code,
      state: 'opaque_state',
    });

    expect(parsed).toEqual({
      outcome: 'authorization_code',
      code,
      state: 'opaque_state',
    });
    expect(parsed.outcome).toBe('authorization_code');
    if (parsed.outcome !== 'authorization_code') {
      throw new Error('Expected authorization-code callback');
    }
    expect(tokenExchange(parsed.code).get('code')).toBe(code);
  });

  it('rejects a byte-different callback state instead of trimming it into stored authority', () => {
    expect(() =>
      parseOAuthCallbackQuery({
        code: 'provider-owned-code',
        state: ' opaque_state ',
      }),
    ).toThrow();
  });

  it('rejects a byte-different browser binding cookie instead of trimming it into transaction authority', () => {
    expect(() =>
      readOpaqueCookie(
        `${OAUTH_BROWSER_COOKIE_NAME}= opaque_browser_binding `,
        OAUTH_BROWSER_COOKIE_NAME,
      ),
    ).toThrow();
  });

  it('rejects a non-PKCE verifier instead of trimming it into a valid verifier', () => {
    expect(() =>
      tokenExchange('provider-owned-code', {
        ...TRANSACTION,
        codeVerifier: ` ${CODE_VERIFIER} `,
      }),
    ).toThrow();
  });
});
