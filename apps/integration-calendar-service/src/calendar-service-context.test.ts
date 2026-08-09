import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CalendarContextInvalidError,
  CalendarContextUnavailableError,
} from './calendar-service-context';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TEST_CONTEXT_KEY = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_291_200;

interface CalendarContextModule {
  requireTrustedCalendarWorkspaceContext(
    headers: Readonly<{
      workspaceId: unknown;
      issuedAt: unknown;
      signature: unknown;
    }>,
    secret: unknown,
    nowSeconds?: number,
  ): string;
}

async function contextModule(): Promise<CalendarContextModule> {
  const modulePath = './calendar-service-context';
  const module = (await import(modulePath).catch(() => ({}))) as Readonly<
    Record<string, unknown>
  >;
  expect(typeof module.requireTrustedCalendarWorkspaceContext).toBe('function');
  return module as unknown as CalendarContextModule;
}

function signature(workspaceId: string, issuedAt: string): string {
  return createHmac('sha256', TEST_CONTEXT_KEY)
    .update(`life-os.calendar-workspace.v1\n${workspaceId}\n${issuedAt}`, 'utf8')
    .digest('base64url');
}

describe('trusted calendar workspace context', () => {
  it('accepts one fresh signed UUIDv4 workspace context', async () => {
    const { requireTrustedCalendarWorkspaceContext } = await contextModule();
    const issuedAt = String(NOW_SECONDS);

    expect(
      requireTrustedCalendarWorkspaceContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt,
          signature: signature(WORKSPACE_ID, issuedAt),
        },
        TEST_CONTEXT_KEY,
        NOW_SECONDS,
      ),
    ).toBe(WORKSPACE_ID);
  });

  it('classifies untrusted contexts as invalid and unusable server configuration as unavailable', async () => {
    const { requireTrustedCalendarWorkspaceContext } = await contextModule();
    const issuedAt = String(NOW_SECONDS);
    const valid = {
      workspaceId: WORKSPACE_ID,
      issuedAt,
      signature: signature(WORKSPACE_ID, issuedAt),
    };
    const invalid = [
      { ...valid, signature: undefined },
      {
        ...valid,
        signature: signature(
          '22222222-2222-4222-8222-222222222222',
          issuedAt,
        ),
      },
      {
        ...valid,
        issuedAt: String(NOW_SECONDS - 61),
        signature: signature(WORKSPACE_ID, String(NOW_SECONDS - 61)),
      },
      {
        ...valid,
        issuedAt: String(NOW_SECONDS + 6),
        signature: signature(WORKSPACE_ID, String(NOW_SECONDS + 6)),
      },
      { ...valid, workspaceId: 'attacker-selected-workspace' },
    ];

    for (const candidate of invalid) {
      expect(() =>
        requireTrustedCalendarWorkspaceContext(
          candidate,
          TEST_CONTEXT_KEY,
          NOW_SECONDS,
        ),
      ).toThrow(CalendarContextInvalidError);
    }
    expect(() =>
      requireTrustedCalendarWorkspaceContext(
        valid,
        'short-secret',
        NOW_SECONDS,
      ),
    ).toThrow(CalendarContextUnavailableError);
  });
});
