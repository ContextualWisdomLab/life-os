import { describe, expect, it } from 'vitest';

const SESSION_BODY = Object.freeze({
  sessionId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  authenticatedAt: '2026-08-09T17:55:00.000Z',
  createdAt: '2026-08-09T17:56:00.000Z',
  expiresAt: '2026-08-10T17:56:00.000Z',
});

interface AuthenticatedApplicationConstructor {
  new (
    sessions: {
      introspectSession(cookieHeader: string | undefined): Promise<{
        statusCode: 200;
        body: typeof SESSION_BODY;
      }>;
    },
    dataRights: {
      exportWorkspace(context: {
        readonly workspaceId: string;
        readonly actorUserId: string;
      }): Promise<unknown>;
    },
    options: {
      readonly now: () => Date;
      readonly maximumAgeMs: number;
    },
  ): {
    exportWorkspace(cookieHeader: string | undefined): Promise<unknown>;
  };
}

async function applicationConstructor(): Promise<AuthenticatedApplicationConstructor> {
  const modulePath = './data-rights-authenticated-application';
  const module = (await import(modulePath).catch(() => ({}))) as Readonly<
    Record<string, unknown>
  >;
  expect(typeof module.AuthenticatedDataRightsApplication).toBe('function');
  return module.AuthenticatedDataRightsApplication as AuthenticatedApplicationConstructor;
}

describe('AuthenticatedDataRightsApplication', () => {
  it('derives export ownership only from the authenticated recent session', async () => {
    const AuthenticatedDataRightsApplication = await applicationConstructor();
    const contexts: unknown[] = [];
    const sessions = {
      async introspectSession(cookieHeader: string | undefined) {
        expect(cookieHeader).toBe('life_os_session=opaque-session');
        return { statusCode: 200 as const, body: SESSION_BODY };
      },
    };
    const dataRights = {
      async exportWorkspace(context: {
        readonly workspaceId: string;
        readonly actorUserId: string;
      }) {
        contexts.push(context);
        return { schemaVersion: 'life-os.data-export.v1' };
      },
    };
    const application = new AuthenticatedDataRightsApplication(
      sessions,
      dataRights,
      {
        now: () => new Date('2026-08-09T18:00:00.000Z'),
        maximumAgeMs: 10 * 60 * 1000,
      },
    );

    await expect(
      application.exportWorkspace('life_os_session=opaque-session'),
    ).resolves.toEqual({ schemaVersion: 'life-os.data-export.v1' });
    expect(contexts).toEqual([
      {
        workspaceId: SESSION_BODY.workspaceId,
        actorUserId: SESSION_BODY.userId,
      },
    ]);
  });
});
