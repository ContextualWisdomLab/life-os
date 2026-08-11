import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireTitle,
  requireTrustedWorkspaceContext,
  toHttpException,
} from './http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GATEWAY_SECRET = randomBytes(32).toString('base64url');
const DIFFERENT_GATEWAY_SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_785_806_400;
const SEARCH_BINDING = { method: 'GET', path: '/v1/search' } as const;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function responseOf(exception: HttpException): unknown {
  return exception.getResponse();
}

function signContext(
  workspaceId: string,
  issuedAt: string,
  secret = GATEWAY_SECRET,
  binding: Readonly<{ method: string; path: string }> = SEARCH_BINDING,
): string {
  return createHmac('sha256', secret)
    .update(
      `life-os.planning-context.v2\n${workspaceId.toLowerCase()}\n${issuedAt}\n${binding.method}\n${binding.path}`,
      'utf8',
    )
    .digest('base64url');
}

function expectProblem(
  operation: () => unknown,
  expected: { status: number; title: string; code: string },
): void {
  try {
    operation();
    throw new Error('Expected operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect(responseOf(error as HttpException)).toEqual({
      type: 'about:blank',
      ...expected,
    });
  }
}

describe('planning HTTP boundary', () => {
  it('rejects a missing or blank title with problem details', () => {
    for (const body of [{}, { title: '   ' }]) {
      expectProblem(() => requireTitle(body), {
        title: 'A title is required',
        status: 400,
        code: 'invalid_title',
      });
    }
  });

  it('normalizes a valid title', () => {
    expect(requireTitle({ title: '  Ship MVP  ' })).toBe('Ship MVP');
  });

  it('accepts a fresh signed gateway workspace context', () => {
    const issuedAt = String(NOW_SECONDS);

    expect(
      requireTrustedWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID.toUpperCase(),
          issuedAt,
          signature: signContext(WORKSPACE_ID, issuedAt),
        },
        GATEWAY_SECRET,
        SEARCH_BINDING,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it('rejects a non-canonical base64url alias for the same signature bytes', () => {
    const issuedAt = String(NOW_SECONDS);
    const canonical = signContext(WORKSPACE_ID, issuedAt);
    const finalIndex = BASE64URL_ALPHABET.indexOf(canonical.at(-1) ?? '');
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex % 4).toBe(0);
    const nonCanonical = `${canonical.slice(0, -1)}${
      BASE64URL_ALPHABET[finalIndex + 1]
    }`;
    expect(Buffer.from(nonCanonical, 'base64url')).toEqual(
      Buffer.from(canonical, 'base64url'),
    );

    expectProblem(
      () =>
        requireTrustedWorkspaceContext(
          {
            workspaceId: WORKSPACE_ID,
            issuedAt,
            signature: nonCanonical,
          },
          GATEWAY_SECRET,
          SEARCH_BINDING,
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it.each([undefined, null, '', 'too-short'])(
    'fails closed when the gateway secret is unavailable: %s',
    (secret) => {
      expectProblem(
        () =>
          requireTrustedWorkspaceContext(
            {
              workspaceId: WORKSPACE_ID,
              issuedAt: String(NOW_SECONDS),
              signature: signContext(WORKSPACE_ID, String(NOW_SECONDS)),
            },
            secret,
            SEARCH_BINDING,
            NOW_SECONDS,
          ),
        {
          title: 'Trusted gateway context is unavailable',
          status: 503,
          code: 'gateway_context_unavailable',
        },
      );
    },
  );

  it.each([
    {
      workspaceId: undefined,
      issuedAt: String(NOW_SECONDS),
      signature: signContext(WORKSPACE_ID, String(NOW_SECONDS)),
      nowSeconds: NOW_SECONDS,
    },
    {
      workspaceId: 'workspace-a',
      issuedAt: String(NOW_SECONDS),
      signature: signContext(WORKSPACE_ID, String(NOW_SECONDS)),
      nowSeconds: NOW_SECONDS,
    },
    {
      workspaceId: WORKSPACE_ID,
      issuedAt: `0${NOW_SECONDS}`,
      signature: signContext(WORKSPACE_ID, String(NOW_SECONDS)),
      nowSeconds: NOW_SECONDS,
    },
    {
      workspaceId: WORKSPACE_ID,
      issuedAt: String(NOW_SECONDS),
      signature: 'invalid',
      nowSeconds: NOW_SECONDS,
    },
    {
      workspaceId: WORKSPACE_ID,
      issuedAt: String(NOW_SECONDS - 61),
      signature: signContext(WORKSPACE_ID, String(NOW_SECONDS - 61)),
      nowSeconds: NOW_SECONDS,
    },
    {
      workspaceId: WORKSPACE_ID,
      issuedAt: String(NOW_SECONDS + 6),
      signature: signContext(WORKSPACE_ID, String(NOW_SECONDS + 6)),
      nowSeconds: NOW_SECONDS,
    },
    {
      workspaceId: WORKSPACE_ID,
      issuedAt: String(NOW_SECONDS),
      signature: signContext(
        WORKSPACE_ID,
        String(NOW_SECONDS),
        DIFFERENT_GATEWAY_SECRET,
      ),
      nowSeconds: NOW_SECONDS,
    },
    {
      workspaceId: WORKSPACE_ID,
      issuedAt: String(NOW_SECONDS),
      signature: signContext(WORKSPACE_ID, String(NOW_SECONDS)),
      nowSeconds: -1,
    },
  ])('rejects malformed, stale, future, or forged context %#', (context) => {
    expectProblem(
      () =>
        requireTrustedWorkspaceContext(
          {
            workspaceId: context.workspaceId,
            issuedAt: context.issuedAt,
            signature: context.signature,
          },
          GATEWAY_SECRET,
          SEARCH_BINDING,
          context.nowSeconds,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it('accepts the documented age and future-skew boundaries', () => {
    for (const issuedAtSeconds of [NOW_SECONDS - 60, NOW_SECONDS + 5]) {
      const issuedAt = String(issuedAtSeconds);
      expect(
        requireTrustedWorkspaceContext(
          {
            workspaceId: WORKSPACE_ID,
            issuedAt,
            signature: signContext(WORKSPACE_ID, issuedAt),
          },
          GATEWAY_SECRET,
          SEARCH_BINDING,
          NOW_SECONDS,
        ),
      ).toBe(WORKSPACE_ID);
    }
  });

  it('maps missing parent entities to credential-free not-found details', () => {
    expect(responseOf(toHttpException(new Error('Goal not found')))).toEqual({
      type: 'about:blank',
      title: 'Planning record not found',
      status: 404,
      code: 'not_found',
    });
    expect(responseOf(toHttpException(new Error('Project not found')))).toEqual(
      {
        type: 'about:blank',
        title: 'Planning record not found',
        status: 404,
        code: 'not_found',
      },
    );
  });

  it.each([
    'Identifier must be an opaque non-numeric string',
    'Planning search request is invalid',
  ])('maps allowlisted validation failure %s to a bad request', (message) => {
    expect(responseOf(toHttpException(new Error(message)))).toEqual({
      type: 'about:blank',
      title: 'Planning request is invalid',
      status: 400,
      code: 'invalid_request',
    });
  });

  it('passes through an existing HTTP exception unchanged', () => {
    const existing = new HttpException('existing', 429);
    expect(toHttpException(existing)).toBe(existing);
  });

  it('maps unexpected persistence failures without leaking details', () => {
    const exception = toHttpException(
      new Error('password=secret SELECT * FROM planning.tasks'),
    );
    expect(exception.getStatus()).toBe(503);
    expect(responseOf(exception)).toEqual({
      type: 'about:blank',
      title: 'Planning persistence is unavailable',
      status: 503,
      code: 'persistence_unavailable',
    });
    expect(JSON.stringify(responseOf(exception))).not.toContain('secret');
    expect(JSON.stringify(responseOf(exception))).not.toContain('SELECT');
  });
});
