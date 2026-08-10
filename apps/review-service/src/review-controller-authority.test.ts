import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewController } from './main';
import type { ReviewService } from './review-domain';

const controllerSource = readFileSync(resolve(__dirname, 'main.ts'), 'utf8');
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
  readonly invoke: (
    controller: ReviewController,
    headers: RouteHeaders,
  ) => Promise<unknown>;
}

const ROUTES: readonly RouteCase[] = [
  {
    name: 'completeDailyPlanning',
    serviceMethod: 'complete',
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

/** Produces a versioned HMAC gateway assertion at one issue time. */
function signedHeaders(issuedAtSeconds: number): RouteHeaders {
  const issuedAt = String(issuedAtSeconds);
  const signature = createHmac('sha256', CONTEXT_SECRET)
    .update(`life-os.workspace.v1\n${WORKSPACE_ID}\n${issuedAt}`, 'utf8')
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
  throw new Error('Expected Review route to reject untrusted workspace context');
}

afterEach(() => {
  delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe.sequential('Review controller tenant authority contract', () => {
  it('rejects browser-selectable workspace authority on every review route', () => {
    expect(controllerSource).not.toContain("@Headers('x-workspace-id')");
    expect(controllerSource).not.toContain('requireWorkspaceHeader(');
    expect(
      controllerSource.match(/@Headers\('x-life-os-workspace-id'\)/gu),
    ).toHaveLength(4);
    expect(
      controllerSource.match(/@Headers\('x-life-os-context-issued-at'\)/gu),
    ).toHaveLength(4);
    expect(
      controllerSource.match(/@Headers\('x-life-os-context-signature'\)/gu),
    ).toHaveLength(4);
    expect(
      controllerSource.match(/requireTrustedWorkspaceContext\(/gu),
    ).toHaveLength(4);
    expect(controllerSource).toContain(
      'process.env.REVIEW_GATEWAY_CONTEXT_SECRET',
    );
  });

  it('passes only the verified workspace to every Review domain route', async () => {
    process.env.REVIEW_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const service = serviceSpies();
    const controller = controllerWith(service);

    for (const route of ROUTES) {
      vi.clearAllMocks();
      await route.invoke(controller, headers);
      expect(service[route.serviceMethod], route.name).toHaveBeenCalledTimes(1);
      expect(service[route.serviceMethod].mock.calls[0]?.[0], route.name).toBe(
        WORKSPACE_ID,
      );
    }
  });

  it('rejects untrusted contexts before every Review domain call', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fresh = signedHeaders(nowSeconds);
    const expired = signedHeaders(nowSeconds - 120);
    const future = signedHeaders(nowSeconds + 120);
    const tampered = {
      ...fresh,
      signature: `${fresh.signature?.slice(0, -1)}${
        fresh.signature?.endsWith('A') ? 'B' : 'A'
      }`,
    };
    const malformed = { ...fresh, workspaceId: 'not-a-uuid' };
    const invalidContexts = [
      { name: 'missing', headers: { ...fresh, workspaceId: undefined }, status: 401 },
      { name: 'expired', headers: expired, status: 401 },
      { name: 'future', headers: future, status: 401 },
      { name: 'tampered', headers: tampered, status: 401 },
      { name: 'malformed', headers: malformed, status: 401 },
      { name: 'secret-unconfigured', headers: fresh, status: 503, secret: false },
    ] as const;
    const service = serviceSpies();
    const controller = controllerWith(service);

    for (const invalid of invalidContexts) {
      for (const route of ROUTES) {
        vi.clearAllMocks();
        if ('secret' in invalid && invalid.secret === false) {
          delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
        } else {
          process.env.REVIEW_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
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
