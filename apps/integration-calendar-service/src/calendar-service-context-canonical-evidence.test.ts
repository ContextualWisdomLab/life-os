import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CalendarContextInvalidError,
  requireTrustedCalendarUserContext,
  requireTrustedCalendarWorkspaceContext,
} from './calendar-service-context';

const WORKSPACE_ID = 'a0b1c2d3-e4f5-4a67-8b9c-d0e1f2a3b4c5';
const USER_ID = 'b1c2d3e4-f5a6-4b78-9c0d-e1f2a3b4c5d6';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_291_200;

function workspaceSignature(workspaceId: string, issuedAt: string): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.calendar-workspace.v1\n${workspaceId}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
}

function userSignature(
  workspaceId: string,
  userId: string,
  issuedAt: string,
): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.calendar-user.v1\n${workspaceId}\n${userId}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
}

describe('Calendar canonical signed context evidence', () => {
  it('rejects case-changed signer-issued workspace evidence without re-signing', () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = workspaceSignature(WORKSPACE_ID, issuedAt);
    const alteredWorkspaceId = WORKSPACE_ID.toUpperCase();

    expect(alteredWorkspaceId).not.toBe(WORKSPACE_ID);
    expect(() =>
      requireTrustedCalendarWorkspaceContext(
        {
          workspaceId: alteredWorkspaceId,
          issuedAt,
          signature,
        },
        CONTEXT_SECRET,
        NOW_SECONDS,
      ),
    ).toThrow(CalendarContextInvalidError);
  });

  it.each([
    ['workspace', WORKSPACE_ID.toUpperCase(), USER_ID],
    ['user', WORKSPACE_ID, USER_ID.toUpperCase()],
  ] as const)(
    'rejects case-changed signer-issued %s evidence in the user context',
    (_field, workspaceId, userId) => {
      const issuedAt = String(NOW_SECONDS);
      const signature = userSignature(WORKSPACE_ID, USER_ID, issuedAt);

      expect(workspaceId !== WORKSPACE_ID || userId !== USER_ID).toBe(true);
      expect(() =>
        requireTrustedCalendarUserContext(
          {
            workspaceId,
            userId,
            issuedAt,
            signature,
          },
          CONTEXT_SECRET,
          NOW_SECONDS,
        ),
      ).toThrow(CalendarContextInvalidError);
    },
  );
});
