import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarConnectionCreateDependencyError,
  type CalendarConnectionCreateResult,
  CalendarConnectionCreateValidationError,
  type CalendarConnectionProviderAuthorization,
} from './calendar-connection-create';
import type { CalendarProvider } from './calendar-sync';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ISSUED_AT = '1786497600';
const TEST_CONTEXT_SECRET = randomBytes(32).toString('base64url');
const ACCESS_TOKEN = randomBytes(24).toString('base64url');
const REFRESH_TOKEN = randomBytes(24).toString('base64url');

const authorization: CalendarConnectionProviderAuthorization = Object.freeze({
  connectionId: CONNECTION_ID,
  providerCode: 'google',
  providerAccountSubject: 'google-subject-123',
  scopeValues: ['calendar.events.readonly'],
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
  tokenExpiresAt: '2026-08-12T03:00:00.000Z',
  selectedCalendarIdentifier: 'primary',
});

interface CreateApplicationDouble {
  create(
    authority: Readonly<{ workspaceId: string; userId: string }>,
    input: CalendarConnectionProviderAuthorization,
  ): Promise<CalendarConnectionCreateResult>;
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

function providerDouble(): CalendarProvider {
  return {
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
  } as unknown as CalendarProvider;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('CalendarConnectionCreateController', () => {
  it('derives workspace-user authority only from signed gateway context', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionCreateController as new (
      application: CreateApplicationDouble,
    ) => {
      createConnection(
        workspaceId: string | undefined,
        userId: string | undefined,
        issuedAt: string | undefined,
        contextSignature: string | undefined,
        body: unknown,
      ): Promise<CalendarConnectionCreateResult>;
    };
    expect(typeof Controller).toBe('function');
    const calls: unknown[] = [];
    const application: CreateApplicationDouble = {
      async create(authority, input) {
        calls.push({ authority, input });
        return Object.freeze({
          connectionId: CONNECTION_ID,
          providerCode: 'google',
          scopeValues: ['calendar.events.readonly'],
          tokenExpiresAt: '2026-08-12T03:00:00.000Z',
          selectedCalendarIdentifier: 'primary',
          status: 'active',
        });
      },
    };
    const controller = new Controller(application);
    const body = {
      ...authorization,
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };

    await expect(
      controller.createConnection(
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        signature(),
        body,
      ),
    ).resolves.toEqual({
      connectionId: CONNECTION_ID,
      providerCode: 'google',
      scopeValues: ['calendar.events.readonly'],
      tokenExpiresAt: '2026-08-12T03:00:00.000Z',
      selectedCalendarIdentifier: 'primary',
      status: 'active',
    });
    expect(calls).toEqual([
      {
        authority: { workspaceId: WORKSPACE_ID, userId: USER_ID },
        input: body,
      },
    ]);
  });

  it('rejects forged context before credential-bearing provider data reaches the application', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionCreateController as new (
      application: CreateApplicationDouble,
    ) => { createConnection(...args: unknown[]): Promise<unknown> };
    const application = { create: vi.fn() };
    const controller = new Controller(application as CreateApplicationDouble);

    await expectProblemStatus(
      controller.createConnection(
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        'A'.repeat(43),
        authorization,
      ),
      401,
    );
    expect(application.create).not.toHaveBeenCalled();
  });

  it('fails closed when trusted gateway verification is not configured', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', '');
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionCreateController as new (
      application: CreateApplicationDouble,
    ) => { createConnection(...args: unknown[]): Promise<unknown> };
    const application = { create: vi.fn() };
    const controller = new Controller(application as CreateApplicationDouble);

    await expectProblemStatus(
      controller.createConnection(
        WORKSPACE_ID,
        USER_ID,
        ISSUED_AT,
        signature(),
        authorization,
      ),
      503,
    );
    expect(application.create).not.toHaveBeenCalled();
  });

  it('maps create validation to 400 and dependency failures to 503', async () => {
    vi.stubEnv('CALENDAR_GATEWAY_CONTEXT_SECRET', TEST_CONTEXT_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(Number(ISSUED_AT) * 1000);
    const module = await controllerModule();
    const Controller = module.CalendarConnectionCreateController as new (
      application: CreateApplicationDouble,
    ) => { createConnection(...args: unknown[]): Promise<unknown> };
    const failures: readonly [Error, number][] = [
      [new CalendarConnectionCreateValidationError(), 400],
      [new CalendarConnectionCreateDependencyError(), 503],
      [new Error('unexpected dependency failure'), 503],
    ];

    for (const [failure, status] of failures) {
      const controller = new Controller({
        async create() {
          throw failure;
        },
      });
      await expectProblemStatus(
        controller.createConnection(
          WORKSPACE_ID,
          USER_ID,
          ISSUED_AT,
          signature(),
          authorization,
        ),
        status,
      );
    }
  });

  it('registers the create controller only when an explicit application is composed', async () => {
    const module = await controllerModule();
    const CalendarAppModule = module.CalendarAppModule as {
      register(
        provider: CalendarProvider,
        disconnectApplication?: unknown,
        readApplication?: unknown,
        createApplication?: CreateApplicationDouble,
      ): { controllers?: readonly unknown[] };
    };
    const Controller = module.CalendarConnectionCreateController;
    const application: CreateApplicationDouble = {
      async create() {
        throw new Error('not exercised');
      },
    };

    expect(
      CalendarAppModule.register(providerDouble(), undefined, undefined)
        .controllers,
    ).not.toContain(Controller);
    expect(
      CalendarAppModule.register(
        providerDouble(),
        undefined,
        undefined,
        application,
      ).controllers,
    ).toContain(Controller);
  });
});
