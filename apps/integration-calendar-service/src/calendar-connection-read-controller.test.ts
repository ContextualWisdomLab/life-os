import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarConnectionReadEvidenceError,
  type CalendarConnectionReadResult,
  CalendarConnectionReadValidationError,
} from './calendar-connection-read';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ISSUED_AT = '1786291200';
const TEST_CONTEXT_SECRET = randomBytes(32).toString('base64url');

interface ReadApplicationDouble {
  getActive(
    authority: Readonly<{ workspaceId: string; userId: string }>,
    connectionId: string,
  ): Promise<CalendarConnectionReadResult | undefined>;
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

describe('CalendarConnectionReadController', () => {
  it('derives read authority only from a signed workspace-user context', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionReadController as new (
      application: ReadApplicationDouble,
    ) => {
      getConnection(
        connectionId: string,
        workspaceId: string | undefined,
        userId: string | undefined,
        issuedAt: string | undefined,
        contextSignature: string | undefined,
      ): Promise<CalendarConnectionReadResult>;
    };
    const calls: unknown[] = [];
    const application: ReadApplicationDouble = {
      async getActive(authority, connectionId) {
        calls.push({ authority, connectionId });
        return Object.freeze({
          connectionId: CONNECTION_ID,
          providerCode: 'google',
          scopeValues: Object.freeze(['calendar.readonly']),
          tokenExpiresAt: '2026-08-11T12:00:00.000Z',
          selectedCalendarIdentifier: 'primary',
          status: 'active',
        });
      },
    };
    const controller = new Controller(application);

    await expect(
      controller.getConnection(
        CONNECTION_ID,
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        signature(),
      ),
    ).resolves.toEqual({
      connectionId: CONNECTION_ID,
      providerCode: 'google',
      scopeValues: ['calendar.readonly'],
      tokenExpiresAt: '2026-08-11T12:00:00.000Z',
      selectedCalendarIdentifier: 'primary',
      status: 'active',
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
    const Controller = module.CalendarConnectionReadController as new (
      application: ReadApplicationDouble,
    ) => { getConnection(...args: unknown[]): Promise<unknown> };
    const controller = new Controller({ async getActive() { return undefined; } });

    await expectProblemStatus(
      controller.getConnection(
        CONNECTION_ID,
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        signature(),
      ),
      404,
    );
  });

  it('rejects forged user context before invoking the read application', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionReadController as new (
      application: ReadApplicationDouble,
    ) => { getConnection(...args: unknown[]): Promise<unknown> };
    let calls = 0;
    const controller = new Controller({
      async getActive() {
        calls += 1;
        return undefined;
      },
    });

    await expectProblemStatus(
      controller.getConnection(
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

  it('maps validation to 400 and persistence-evidence/dependency failures to 503', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionReadController as new (
      application: ReadApplicationDouble,
    ) => { getConnection(...args: unknown[]): Promise<unknown> };
    const failures: readonly [Error, number][] = [
      [new CalendarConnectionReadValidationError(), 400],
      [new CalendarConnectionReadEvidenceError(), 503],
      [new Error('database unavailable'), 503],
    ];

    for (const [failure, status] of failures) {
      const controller = new Controller({
        async getActive() {
          throw failure;
        },
      });
      await expectProblemStatus(
        controller.getConnection(
          CONNECTION_ID,
          WORKSPACE_ID,
          USER_ID,
          ISSUED_AT,
          signature(),
        ),
        status,
      );
    }
  });
});
