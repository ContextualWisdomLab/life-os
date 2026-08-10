import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireHistoryLimit,
  requireRitualPath,
  requireTrustedWorkspaceContext,
  toReviewHttpException,
} from './http-boundary';
import {
  ReviewCompletionConflictError,
  ReviewValidationError,
} from './review-domain';
import { ReviewPersistenceError } from './postgres-review-repository';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_334_400;

function response(error: HttpException): unknown {
  return error.getResponse();
}

function signature(issuedAt: string, workspaceId = WORKSPACE_ID): string {
  return createHmac('sha256', SECRET)
    .update(`life-os.workspace.v1\n${workspaceId}\n${issuedAt}`, 'utf8')
    .digest('base64url');
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
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
    expect(requireRitualPath('weekly-review')).toBe('weekly-review');
    expect(requireHistoryLimit(undefined)).toBe(50);
    expect(requireHistoryLimit('100')).toBe(100);
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
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it.each([
    {
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS - 61),
        signature: signature(String(NOW_SECONDS - 61)),
      },
      secret: SECRET,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS + 6),
        signature: signature(String(NOW_SECONDS + 6)),
      },
      secret: SECRET,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: 'A'.repeat(43),
      },
      secret: SECRET,
      status: 401,
      code: 'invalid_gateway_context',
    },
    {
      headers: {
        workspaceId: WORKSPACE_ID,
        issuedAt: String(NOW_SECONDS),
        signature: signature(String(NOW_SECONDS)),
      },
      secret: 'too-short',
      status: 503,
      code: 'gateway_context_unavailable',
    },
  ])(
    'fails closed for stale, future, forged, or unverifiable context',
    ({ headers, secret, status, code }) => {
      try {
        requireTrustedWorkspaceContext(headers, secret, NOW_SECONDS);
        throw new Error('expected trusted context rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect(response(error as HttpException)).toMatchObject({ status, code });
      }
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
