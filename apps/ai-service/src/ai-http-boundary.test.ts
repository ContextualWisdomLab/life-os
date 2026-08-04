import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireTrustedAiContext,
  type TrustedAiContextHeaders,
} from './ai-http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
const GATEWAY_SECRET = 'trusted-ai-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_785_806_400;

/** Creates the exact versioned HMAC expected by the AI service boundary. */
function signContext(
  input: {
    workspaceId?: string;
    actorId?: string;
    issuedAt?: string;
    method?: string;
    path?: string;
    secret?: string;
  } = {},
): string {
  const workspaceId = (input.workspaceId ?? WORKSPACE_ID).toLowerCase();
  const actorId = (input.actorId ?? ACTOR_ID).toLowerCase();
  const issuedAt = input.issuedAt ?? String(NOW_SECONDS);
  const method = input.method ?? 'POST';
  const path = input.path ?? '/v1/proposals';
  const secret = input.secret ?? GATEWAY_SECRET;
  return createHmac('sha256', secret)
    .update(
      `life-os.ai-context.v1\n${workspaceId}\n${actorId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

/** Returns one complete context header object with optional field overrides. */
function contextHeaders(
  overrides: Partial<TrustedAiContextHeaders> = {},
): TrustedAiContextHeaders {
  return {
    workspaceId: WORKSPACE_ID,
    actorId: ACTOR_ID,
    issuedAt: String(NOW_SECONDS),
    signature: signContext(),
    ...overrides,
  };
}

/** Asserts one stable credential-free problem response. */
function expectProblem(
  operation: () => unknown,
  expected: { status: number; title: string; code: string },
): void {
  try {
    operation();
    throw new Error('Expected trusted AI context validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    expect(exception.getStatus()).toBe(expected.status);
    expect(exception.getResponse()).toEqual({
      type: 'about:blank',
      ...expected,
    });
  }
}

describe('trusted AI service context', () => {
  it('accepts an exact fresh method-and-path-bound context', () => {
    expect(
      requireTrustedAiContext(
        contextHeaders({
          workspaceId: WORKSPACE_ID.toUpperCase(),
          actorId: ACTOR_ID.toUpperCase(),
        }),
        GATEWAY_SECRET,
        'POST',
        '/v1/proposals',
        NOW_SECONDS,
      ),
    ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
  });

  it('accepts proposal and decision paths at the documented time boundaries', () => {
    for (const input of [
      {
        issuedAt: NOW_SECONDS - 60,
        method: 'GET',
        path: `/v1/proposals/${PROPOSAL_ID}`,
      },
      {
        issuedAt: NOW_SECONDS + 5,
        method: 'POST',
        path: `/v1/proposals/${PROPOSAL_ID}/decisions`,
      },
    ] as const) {
      const issuedAt = String(input.issuedAt);
      expect(
        requireTrustedAiContext(
          contextHeaders({
            issuedAt,
            signature: signContext({
              issuedAt,
              method: input.method,
              path: input.path,
            }),
          }),
          GATEWAY_SECRET,
          input.method,
          input.path,
          NOW_SECONDS,
        ),
      ).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
    }
  });

  it.each([
    undefined,
    null,
    '',
    'too-short',
    'x'.repeat(4097),
    `x${String.fromCharCode(0)}y`,
  ])('fails closed when the gateway secret is unavailable: %#', (secret) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders(),
          secret,
          'POST',
          '/v1/proposals',
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is unavailable',
        status: 503,
        code: 'gateway_context_unavailable',
      },
    );
  });

  it.each([
    { field: 'workspaceId', value: undefined },
    { field: 'workspaceId', value: 'workspace-a' },
    { field: 'actorId', value: null },
    { field: 'actorId', value: 'actor-a' },
    { field: 'issuedAt', value: `0${NOW_SECONDS}` },
    { field: 'issuedAt', value: 'not-a-time' },
    { field: 'issuedAt', value: '12345678901234' },
    { field: 'signature', value: undefined },
    { field: 'signature', value: 'invalid' },
    { field: 'signature', value: `${'a'.repeat(42)}!` },
  ])('rejects malformed context field $field: %#', ({ field, value }) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders({ [field]: value }),
          GATEWAY_SECRET,
          'POST',
          '/v1/proposals',
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it.each([
    { issuedAt: NOW_SECONDS - 61, nowSeconds: NOW_SECONDS },
    { issuedAt: NOW_SECONDS + 6, nowSeconds: NOW_SECONDS },
    { issuedAt: NOW_SECONDS, nowSeconds: -1 },
    { issuedAt: NOW_SECONDS, nowSeconds: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    'rejects stale, future, or invalid clock input %#',
    ({ issuedAt, nowSeconds }) => {
      const issuedAtText = String(issuedAt);
      expectProblem(
        () =>
          requireTrustedAiContext(
            contextHeaders({
              issuedAt: issuedAtText,
              signature: signContext({ issuedAt: issuedAtText }),
            }),
            GATEWAY_SECRET,
            'POST',
            '/v1/proposals',
            nowSeconds,
          ),
        {
          title: 'Trusted gateway context is invalid',
          status: 401,
          code: 'invalid_gateway_context',
        },
      );
    },
  );

  it.each([
    { method: 'post', path: '/v1/proposals' },
    { method: 'PUT', path: '/v1/proposals' },
    { method: 42, path: '/v1/proposals' },
    { method: 'GET', path: '/v1/proposals/' },
    { method: 'GET', path: '/v1/proposals?workspace=other' },
    { method: 'GET', path: `/v1/proposals/${PROPOSAL_ID.toUpperCase()}` },
    { method: 'GET', path: '/v1/proposals/not-a-uuid' },
    { method: 'GET', path: '/v1/proposals/decisions' },
    { method: 'GET', path: '/v1/proposals\n' },
    { method: 'GET', path: 42 },
  ])('rejects noncanonical method or path %#', ({ method, path }) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders(),
          GATEWAY_SECRET,
          method,
          path,
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it('rejects a noncanonical base64url spelling of a 32-byte signature', () => {
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const canonical = signContext();
    const finalIndex = alphabet.indexOf(canonical[canonical.length - 1]);
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex % 4).toBe(0);
    const alternateFinalCharacter = alphabet[finalIndex + 1]!;
    expect(alternateFinalCharacter).toBeDefined();
    const noncanonical = `${canonical.slice(0, -1)}${alternateFinalCharacter}`;

    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders({ signature: noncanonical }),
          GATEWAY_SECRET,
          'POST',
          '/v1/proposals',
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });

  it.each([
    {
      method: 'GET',
      path: '/v1/proposals',
      signature: signContext({ method: 'POST' }),
    },
    {
      method: 'POST',
      path: `/v1/proposals/${PROPOSAL_ID}`,
      signature: signContext({ method: 'POST', path: '/v1/proposals' }),
    },
    {
      method: 'POST',
      path: '/v1/proposals',
      signature: signContext({
        secret: 'another-gateway-secret-with-32-bytes',
      }),
    },
  ])('rejects method replay, path replay, or forged signature %#', (input) => {
    expectProblem(
      () =>
        requireTrustedAiContext(
          contextHeaders({ signature: input.signature }),
          GATEWAY_SECRET,
          input.method,
          input.path,
          NOW_SECONDS,
        ),
      {
        title: 'Trusted gateway context is invalid',
        status: 401,
        code: 'invalid_gateway_context',
      },
    );
  });
});
