import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireHistoryLimit,
  requireRitualPath,
  requireTrustedWorkspaceContext,
  toReviewHttpException,
  type ReviewTrustedRequestBinding,
} from './http-boundary';
import {
  ReviewCompletionConflictError,
  ReviewValidationError,
} from './review-domain';
import { ReviewPersistenceError } from './postgres-review-repository';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const OTHER_WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c043';
const SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_334_400;
const HISTORY_BINDING = {
  method: 'GET',
  path: '/v1/reviews/completions',
} as const;
const DAILY_PLANNING_BINDING = {
  method: 'POST',
  path: '/v1/reviews/daily-planning/completions',
} as const;
const WEEKLY_REVIEW_BINDING = {
  method: 'POST',
  path: '/v1/reviews/weekly-review/completions',
} as const;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function response(error: HttpException): unknown {
  return error.getResponse();
}

function signature(
  issuedAt: string,
  binding: { method: 'GET' | 'POST'; path: string } = HISTORY_BINDING,
  workspaceId = WORKSPACE_ID,
): string {
  return createHmac('sha256', SECRET)
    .update(
      `life-os.review-context.v1\n${workspaceId}\n${issuedAt}\n${binding.method}\n${binding.path}`,
      'utf8',
    )
    .digest('base64url');
}

function expectTrustedContextRejection(
  headers: { workspaceId: unknown; issuedAt: unknown; signature: unknown },
  secret: unknown,
  requestBinding: ReviewTrustedRequestBinding,
  nowSeconds: number,
  status: number,
  code: string,
): void {
  const operation = () =>
    requireTrustedWorkspaceContext(headers, secret, requestBinding, nowSeconds);
  expect(operation).toThrow(HttpException);

  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(HttpException);
  expect(response(thrown as HttpException)).toMatchObject({ status, code });
}

describe('Review HTTP boundary', () => {
  it('accepts fresh signed workspace context and bounded ritual/history values', () => {
    const issuedAt = String(NOW_SECONDS - 30);
    expect(
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID.toUpperCase(),
          issuedAt,
          signature: signature(issuedAt),
        },
        SECRET,
        HISTORY_BINDING,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
    expect(requireRitualPath('weekly-review')).toBe('weekly-review');
    expect(requireHistoryLimit(undefined)).toBe(50);
    expect(requireHistoryLimit('100')).toBe(100);
  });

  it('accepts a signed completion request binding', () => {
    const issuedAt = String(NOW_SECONDS);
    expect(
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt,
          signature: signature(issuedAt, DAILY_PLANNING_BINDING),
        },
        SECRET,
        DAILY_PLANNING_BINDING,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it('rejects replaying a history signature as a completion request', () => {
    const issuedAt = String(NOW_SECONDS);
    expectTrustedContextRejection(
      {
        workspaceId: WORKSPACE_ID,
        issuedAt,
        signature: signature(issuedAt, HISTORY_BINDING),
      },
      SECRET,
      DAILY_PLANNING_BINDING,
      NOW_SECONDS,
      401,
      'invalid_gateway_context',
    );
  });

  it('rejects replaying one completion signature on another completion path', () => {
    const issuedAt = String(NOW_SECONDS);
    expectTrustedContextRejection(
      {
        workspaceId: WORKSPACE_ID,
        issuedAt,
        signature: signature(issuedAt, DAILY_PLANNING_BINDING),
      },
      SECRET,
      WEEKLY_REVIEW_BINDING,
      NOW_SECONDS,
      401,
      'invalid_gateway_context',
    );
  });

  it('accepts the exact maximum context age', () => {
    const issuedAt = String(NOW_SECONDS - 60);
    expect(
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt,
          signature: signature(issuedAt),
        },
        SECRET,
        HISTORY_BINDING,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it('accepts the exact maximum future clock skew', () => {
    const issuedAt = String(NOW_SECONDS + 5);
    expect(
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt,
          signature: signature(issuedAt),
        },
        SECRET,
        HISTORY_BINDING,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it('rejects a non-canonical base64url alias for the same signature bytes', () => {
    const issuedAt = String(NOW_SECONDS);
    const canonical = signature(issuedAt);
    const finalIndex = BASE64URL_ALPHABET.indexOf(canonical.at(-1) ?? '');
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex % 4).toBe(0);
    const aliasCharacter = BASE64URL_ALPHABET[finalIndex + 1];
    expect(aliasCharacter).toBeDefined();
    const nonCanonical = `${canonical.slice(0, -1)}${aliasCharacter}`;
    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(
      Buffer.from(canonical, 'base64url'),
    );

    expect(() =>
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt,
          signature: nonCanonical,
        },
        SECRET,
        HISTORY_BINDING,
        NOW_SECONDS,
      ),
    ).toThrow(HttpException);
  });

  it.each([
    {
      name: 'stale timestamp',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS - 61),
        signature: signature(String(NOW_SECONDS - 61)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'future timestamp',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS + 6),
        signature: signature(String(NOW_SECONDS + 6)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'forged signature',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: 'A'.repeat(43),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'signature bound to another workspace',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(
          String(NOW_SECONDS),
          HISTORY_BINDING,
          OTHER_WORKSPACE_ID,
        ),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'unsupported request method',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: { method: 'DELETE', path: '/v1/reviews/completions' },
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'unsupported request path',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: { method: 'POST', path: '/v1/reviews/completions' },
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'short verifier secret',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: 'too-short',
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 503,
      code: 'gateway_context_unavailable',
    },
    {
      name: 'missing verifier secret',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: undefined,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 503,
      code: 'gateway_context_unavailable',
    },
    {
      name: 'missing workspace header',
      headers: {
        workspaceId: undefined,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'non-string workspace header',
      headers: {
        workspaceId: 123,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'invalid workspace UUID',
      headers: {
        workspaceId: 'not-a-uuid',
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'missing issued-at header',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: undefined,
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'non-string issued-at header',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: 123,
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'nonnumeric issued-at header',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: 'not-a-timestamp',
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'missing signature header',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: undefined,
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'non-string signature header',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: 123,
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'wrong-length signature',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: 'A'.repeat(42),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'invalid base64url signature characters',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: '!'.repeat(43),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: NOW_SECONDS,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      name: 'non-integer verifier clock',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: Number.NaN,
      status: 503,
      code: 'gateway_context_unavailable',
    },
    {
      name: 'negative verifier clock',
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: SECRET,
      binding: HISTORY_BINDING,
      nowSeconds: -1,
      status: 503,
      code: 'gateway_context_unavailable',
    },
  ])(
    'fails closed for $name',
    ({ headers, secret, binding, nowSeconds, status, code }) => {
      expectTrustedContextRejection(
        headers,
        secret,
        binding,
        nowSeconds,
        status,
        code,
      );
    },
  );

  it.each([
    () => requireRitualPath('execute'),
    () => requireHistoryLimit('101'),
  ])('returns bounded problems for invalid boundary input', (operation) => {
    expect(operation).toThrow(HttpException);
  });

  it('maps known failures without leaking exception details', () => {
    const conflict = toReviewHttpException(new ReviewCompletionConflictError());
    expect(response(conflict)).toEqual({
      type: 'about:blank',
      title: 'Review completion conflicts with immutable evidence',
      status: 409,
      code: 'completion_conflict',
    });

    expect(
      response(toReviewHttpException(new ReviewValidationError('secret'))),
    ).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(
      response(toReviewHttpException(new ReviewPersistenceError())),
    ).toMatchObject({ status: 503, code: 'persistence_unavailable' });
    expect(
      JSON.stringify(
        toReviewHttpException(new Error('database password')).getResponse(),
      ),
    ).not.toContain('password');
  });
});
