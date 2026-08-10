import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewController } from './main';
import type { ReviewService } from './review-domain';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');

interface RouteHeaders {
  readonly workspaceId: string | undefined;
  readonly issuedAt: string | undefined;
  readonly signature: string | undefined;
}

interface ReviewServiceSpies {
  readonly complete: ReturnType<typeof vi.fn>;
  readonly list: ReturnType<typeof vi.fn>;
}

interface RouteCase {
  readonly name: string;
  readonly serviceMethod: keyof ReviewServiceSpies;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly invoke: (
    controller: ReviewController,
    headers: RouteHeaders,
  ) => Promise<unknown>;
}

const ROUTES: readonly RouteCase[] = [
  {
    name: 'completeDailyPlanning',
    serviceMethod: 'complete',
    method: 'POST',
    path: '/v1/reviews/daily-planning/completions',
    invoke: (controller, headers) =>
      controller.completeDailyPlanning(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        {},
      ),
  },
  {
    name: 'completeDailyShutdown',
    serviceMethod: 'complete',
    method: 'POST',
    path: '/v1/reviews/daily-shutdown/completions',
    invoke: (controller, headers) =>
      controller.completeDailyShutdown(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        {},
      ),
  },
  {
    name: 'completeWeeklyReview',
    serviceMethod: 'complete',
    method: 'POST',
    path: '/v1/reviews/weekly-review/completions',
    invoke: (controller, headers) =>
      controller.completeWeeklyReview(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        {},
      ),
  },
  {
    name: 'listCompletions',
    serviceMethod: 'list',
    method: 'GET',
    path: '/v1/reviews/completions',
    invoke: (controller, headers) =>
      controller.listCompletions(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        '10',
      ),
  },
];

/** Creates observable Review service boundaries without persistence. */
function serviceSpies(): ReviewServiceSpies {
  return {
    complete: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([]),
  };
}

/** Creates a controller whose domain calls can prove tenant authority flow. */
function controllerWith(service: ReviewServiceSpies): ReviewController {
  return new ReviewController(service as unknown as ReviewService);
}

/** Produces a request-bound HMAC gateway assertion at one issue time. */
function signedHeaders(route: RouteCase, issuedAtSeconds: number): RouteHeaders {
  const issuedAt = String(issuedAtSeconds);
  const signature = createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.review-context.v1\n${WORKSPACE_ID}\n${issuedAt}\n${route.method}\n${route.path}`,
      'utf8',
    )
    .digest('base64url');
  return { workspaceId: WORKSPACE_ID, issuedAt, signature };
}

/** Returns the bounded HTTP status from an expected rejected route call. */
async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
  throw new Error(
    'Expected Review route to reject untrusted workspace context',
  );
}

afterEach(() => {
  delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe.sequential('Review controller tenant authority contract', () => {
  it('rejects a browser-selected workspace header without signed context', async () => {
    process.env.REVIEW_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const service = serviceSpies();
    const controller = controllerWith(service);
    const headers: RouteHeaders = {
      workspaceId: WORKSPACE_ID,
      issuedAt: undefined,
      signature: undefined,
    };

    for (const route of ROUTES) {
      vi.clearAllMocks();
      expect(await rejectedStatus(route.invoke(controller, headers))).toBe(401);
      expect(service[route.serviceMethod], route.name).not.toHaveBeenCalled();
    }
  });

  it('passes only the verified workspace to every Review domain route', async () => {
    process.env.REVIEW_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const service = serviceSpies();
    const controller = controllerWith(service);

    for (const route of ROUTES) {
      vi.clearAllMocks();
      await route.invoke(controller, signedHeaders(route, nowSeconds));
      expect(service[route.serviceMethod], route.name).toHaveBeenCalledTimes(1);
      expect(service[route.serviceMethod].mock.calls[0]?.[0], route.name).toBe(
        WORKSPACE_ID,
      );
    }
  });

  it('rejects untrusted contexts before every Review domain call', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const service = serviceSpies();
    const controller = controllerWith(service);

    for (const route of ROUTES) {
      const fresh = signedHeaders(route, nowSeconds);
      const expired = signedHeaders(route, nowSeconds - 120);
      const future = signedHeaders(route, nowSeconds + 120);
      const tamperedDigest = Buffer.from(fresh.signature ?? '', 'base64url');
      const firstTamperedByte = tamperedDigest.at(0);
      if (firstTamperedByte === undefined) {
        throw new Error('Expected a SHA-256 gateway signature');
      }
      tamperedDigest[0] = firstTamperedByte ^ 0xff;
      const invalidContexts = [
        {
          name: 'missing',
          headers: { ...fresh, workspaceId: undefined },
          status: 401,
          secretConfigured: true,
        },
        {
          name: 'expired',
          headers: expired,
          status: 401,
          secretConfigured: true,
        },
        {
          name: 'future',
          headers: future,
          status: 401,
          secretConfigured: true,
        },
        {
          name: 'tampered',
          headers: {
            ...fresh,
            signature: tamperedDigest.toString('base64url'),
          },
          status: 401,
          secretConfigured: true,
        },
        {
          name: 'malformed',
          headers: { ...fresh, workspaceId: 'not-a-uuid' },
          status: 401,
          secretConfigured: true,
        },
        {
          name: 'secret-unconfigured',
          headers: fresh,
          status: 503,
          secretConfigured: false,
        },
      ] as const;

      for (const invalid of invalidContexts) {
        vi.clearAllMocks();
        if (invalid.secretConfigured) {
          process.env.REVIEW_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
        } else {
          delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
        }
        expect(
          await rejectedStatus(route.invoke(controller, invalid.headers)),
          `${route.name}:${invalid.name}`,
        ).toBe(invalid.status);
        expect(
          service[route.serviceMethod],
          `${route.name}:${invalid.name}`,
        ).not.toHaveBeenCalled();
      }
    }
  });
});
