import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTrustedWorkspaceContext } from './http-boundary';
import { signReviewTestContext } from './review-context.test-helper';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const SECRET = 'review-canonical-evidence-secret-0001';
const NOW_SECONDS = 1_786_334_400;
const BINDING = {
  method: 'GET',
  path: '/v1/reviews/completions',
} as const;

describe('Review trusted workspace canonical evidence', () => {
  it('rejects a case-changed signed workspace without re-signing', () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = signReviewTestContext({
      secret: SECRET,
      workspaceId: WORKSPACE_ID,
      issuedAt,
      binding: BINDING,
    });
    const mutatedWorkspaceId = WORKSPACE_ID.toUpperCase();

    expect(mutatedWorkspaceId).not.toBe(WORKSPACE_ID);
    expect(() =>
      requireTrustedWorkspaceContext(
        {
          workspaceId: mutatedWorkspaceId,
          issuedAt,
          signature,
        },
        SECRET,
        BINDING,
        NOW_SECONDS,
      ),
    ).toThrow(HttpException);
  });
});
