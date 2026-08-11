import { createHmac } from 'node:crypto';

/** HTTP request identity included in a signed Review gateway context. */
export interface ReviewContextTestBinding {
  readonly method: 'GET' | 'POST';
  readonly path: string;
}

/**
 * Produces the canonical Review gateway-context HMAC used by boundary tests.
 *
 * Test callers provide the same normalized workspace, issue time, method, and
 * path that production verification binds. Centralizing this payload prevents
 * tests from silently diverging when the request-bound authority contract
 * changes.
 */
export function signReviewTestContext(input: {
  readonly secret: string;
  readonly workspaceId: string;
  readonly issuedAt: string;
  readonly binding: ReviewContextTestBinding;
}): string {
  return createHmac('sha256', input.secret)
    .update(
      `life-os.review-context.v1\n${input.workspaceId.toLowerCase()}\n${input.issuedAt}\n${input.binding.method}\n${input.binding.path}`,
      'utf8',
    )
    .digest('base64url');
}
