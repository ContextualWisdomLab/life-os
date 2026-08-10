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

type InvalidContextCase = readonly [
  name: string,
  headers: RouteHeaders,
  status: number,
  secretConfigured: boolean,
];

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
  it('rejects legacy browser-selectable workspace authority', () => {
    expect(controllerSource).not.toContain("@Headers('x-workspace-id')");
    expect(controllerSource).not.toContain('requireWorkspaceHeader(');
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
      expect(
        service[route.serviceMethod].mock.calls[0]?.[0],
        route.name,
      ).toBe(WORKSPACE_ID);
    }
  });

  it('rejects untrusted contexts before every Review domain call', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fresh = signedHeaders(nowSeconds);
    const expired = signedHeaders(nowSeconds - 120);
    const future = signedHeaders(nowSeconds + 120);
    const tamperedDigest = Buffer.from(fresh.signature ?? '', 'base64url');
    const firstTamperedByte = tamperedDigest.at(0);
    if (firstTamperedByte === undefined) {
      throw new Error('Expected a SHA-256 gateway signature');
    }
    tamperedDigest[0] = firstTamperedByte ^ 0xff;
    const tampered = {
      ...fresh,
      signature: tamperedDigest.toString('base64url'),
    };
    const malformed = { ...fresh, workspaceId: 'not-a-uuid' };
    const invalidContexts: readonly InvalidContextCase[] = [
      ['missing', { ...fresh, workspaceId: undefined }, 401, true],
      ['expired', expired, 401, true],
      ['future', future, 401, true],
      ['tampered', tampered, 401, true],
      ['malformed', malformed, 401, true],
      ['secret-unconfigured', fresh, 503, false],
    ];
    const service = serviceSpies();
    const controller = controllerWith(service);

    for (const [name, headers, status, secretConfigured] of invalidContexts) {
      for (const route of ROUTES) {
        vi.clearAllMocks();
        if (secretConfigured) {
          process.env.REVIEW_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
        } else {
          delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
        }
        expect(
          await rejectedStatus(route.invoke(controller, headers)),
          `${route.name}:${name}`,
        ).toBe(status);
        expect(
          service[route.serviceMethod],
          `${route.name}:${name}`,
        ).not.toHaveBeenCalled();
      }
    }
  });
});
