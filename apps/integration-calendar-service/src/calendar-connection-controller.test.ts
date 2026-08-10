import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarConnectionDisconnectResult } from './calendar-connection-disconnect';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ISSUED_AT = '1786291200';
const TEST_CONTEXT_SECRET = randomBytes(32).toString('base64url');

interface DisconnectApplicationDouble {
  disconnect(
    authority: Readonly<{ workspaceId: string; userId: string }>,
    connectionId: string,
  ): Promise<CalendarConnectionDisconnectResult | undefined>;
}

function signature(): string {
  return createHmac('sha256', TEST_CONTEXT_SECRET)
    .update(
      `life-os.calendar-user.v1\n${WORKSPACE_ID}\n${USER_ID}\n${ISSUED_AT}`,
      'utf8',
    )
    .digest('base64url');
}

async function controllerModule(): Promise<Readonly<Record<string, unknown>>> {
  return import('./main');
}

async function expectProblemStatus(
  operation: Promise<unknown>,
  expectedStatus: number,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(expectedStatus);
    return;
  }
  throw new Error(`Expected HTTP ${expectedStatus} failure`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('CalendarConnectionController', () => {
  it('accepts only a valid signed workspace-user context and returns bounded local revocation evidence', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionController as new (
      application: DisconnectApplicationDouble,
    ) => {
      disconnectConnection(
        connectionId: string,
        workspaceId: string | undefined,
        userId: string | undefined,
        issuedAt: string | undefined,
        contextSignature: string | undefined,
      ): Promise<CalendarConnectionDisconnectResult>;
    };
    expect(typeof Controller).toBe('function');
    const calls: unknown[] = [];
    const application: DisconnectApplicationDouble = {
      async disconnect(authority, connectionId) {
        calls.push({ authority, connectionId });
        return Object.freeze({
          connectionId: CONNECTION_ID,
          status: 'revoked',
          revokedAt: '2026-08-10T03:45:00.000Z',
        });
      },
    };
    const controller = new Controller(application);

    await expect(
      controller.disconnectConnection(
        CONNECTION_ID,
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        signature(),
      ),
    ).resolves.toEqual({
      connectionId: CONNECTION_ID,
      status: 'revoked',
      revokedAt: '2026-08-10T03:45:00.000Z',
    });
    expect(calls).toEqual([
      {
        authority: { workspaceId: WORKSPACE_ID, userId: USER_ID },
        connectionId: CONNECTION_ID,
      },
    ]);
  });

  it('maps absent owned connections to indistinguishable 404 evidence', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionController as new (
      application: DisconnectApplicationDouble,
    ) => {
      disconnectConnection(...args: unknown[]): Promise<unknown>;
    };
    const controller = new Controller({ async disconnect() { return undefined; } });

    await expectProblemStatus(
      controller.disconnectConnection(
        CONNECTION_ID,
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        signature(),
      ),
      404,
    );
  });

  it('rejects forged user context before invoking the application', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionController as new (
      application: DisconnectApplicationDouble,
    ) => {
      disconnectConnection(...args: unknown[]): Promise<unknown>;
    };
    let calls = 0;
    const controller = new Controller({
      async disconnect() {
        calls += 1;
        return undefined;
      },
    });

    await expectProblemStatus(
      controller.disconnectConnection(
        CONNECTION_ID,
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        'A'.repeat(43),
      ),
      401,
    );
    expect(calls).toBe(0);
  });

  it('fails closed with 503 when trusted-context verification is not configured', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', '');
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionController as new (
      application: DisconnectApplicationDouble,
    ) => {
      disconnectConnection(...args: unknown[]): Promise<unknown>;
    };
    const controller = new Controller({ async disconnect() { return undefined; } });

    await expectProblemStatus(
      controller.disconnectConnection(
        CONNECTION_ID,
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        signature(),
      ),
      503,
    );
  });
});
