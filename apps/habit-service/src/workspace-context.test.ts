import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTrustedWorkspaceContext } from './http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GATEWAY_SECRET = 'trusted-habit-gateway-secret-32-bytes';
const NOW_SECONDS = 1_786_291_200;

function sign(
  workspaceId: string,
  issuedAt: string,
  secret = GATEWAY_SECRET,
): string {
  return createHmac('sha256', secret)
    .update(
      `life-os.workspace.v1\n${workspaceId.toLowerCase()}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
}

function expectProblem(
  operation: () => unknown,
  status: number,
  code: string,
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toMatchObject({ status, code });
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

describe('Habit signed workspace context', () => {
  it('accepts a fresh canonical signed workspace context', () => {
    const issuedAt = String(NOW_SECONDS);
    expect(
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID.toUpperCase(),
          issuedAt,
          signature: sign(WORKSPACE_ID, issuedAt),
        },
        GATEWAY_SECRET,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it.each([undefined, null, '', 'too-short'])(
    'fails closed when context verification secret is unavailable: %s',
    (secret) => {
      const issuedAt = String(NOW_SECONDS);
      expectProblem(
        () =>
          requireTrustedWorkspaceContext(
            {
              workspaceId: WORKSPACE_ID,
              issuedAt,
              signature: sign(WORKSPACE_ID, issuedAt),
            },
            secret,
            NOW_SECONDS,
          ),
        503,
        'gateway_context_unavailable',
      );
    },
  );

  it.each([
    { workspaceId: 'not-a-uuid', issuedAt: String(NOW_SECONDS) },
    { workspaceId: WORKSPACE_ID, issuedAt: `0${NOW_SECONDS}` },
    { workspaceId: WORKSPACE_ID, issuedAt: String(NOW_SECONDS - 61) },
    { workspaceId: WORKSPACE_ID, issuedAt: String(NOW_SECONDS + 6) },
  ])('rejects malformed or out-of-window context %#', (candidate) => {
    expectProblem(
      () =>
        requireTrustedWorkspaceContext(
          {
            workspaceId: candidate.workspaceId,
            issuedAt: candidate.issuedAt,
            signature: sign(WORKSPACE_ID, candidate.issuedAt),
          },
          GATEWAY_SECRET,
          NOW_SECONDS,
        ),
      401,
      'invalid_gateway_context',
    );
  });

  it('rejects a forged signature and invalid verification clock', () => {
    const issuedAt = String(NOW_SECONDS);
    for (const [signature, nowSeconds] of [
      ['A'.repeat(43), NOW_SECONDS],
      [sign(WORKSPACE_ID, issuedAt), -1],
    ] as const) {
      expectProblem(
        () =>
          requireTrustedWorkspaceContext(
            { workspaceId: WORKSPACE_ID, issuedAt, signature },
            GATEWAY_SECRET,
            nowSeconds,
          ),
        401,
        'invalid_gateway_context',
      );
    }
  });

  it('accepts the maximum age and future-skew boundaries', () => {
    for (const issuedAtSeconds of [NOW_SECONDS - 60, NOW_SECONDS + 5]) {
      const issuedAt = String(issuedAtSeconds);
      expect(
        requireTrustedWorkspaceContext(
          {
            workspaceId: WORKSPACE_ID,
            issuedAt,
            signature: sign(WORKSPACE_ID, issuedAt),
          },
          GATEWAY_SECRET,
          NOW_SECONDS,
        ),
      ).toBe(WORKSPACE_ID);
    }
  });
});
