import { describe, expect, it, vi } from 'vitest';

const SESSION = Object.freeze({
  sessionId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  authenticatedAt: '2026-08-10T00:00:00.000Z',
  createdAt: '2026-08-10T00:00:00.000Z',
  expiresAt: '2026-08-11T00:00:00.000Z',
});
const REQUEST_ID = '44444444-4444-4444-8444-444444444444';

async function loadStatusModule(): Promise<Readonly<Record<string, unknown>>> {
  const modulePath = './data-rights-status-application';
  return import(modulePath).catch(() => ({}));
}

describe('AuthenticatedDataRightsStatusApplication', () => {
  it('derives request lookup scope only from the authenticated session', async () => {
    const module = await loadStatusModule();
    expect(typeof module.AuthenticatedDataRightsStatusApplication).toBe(
      'function',
    );
    const Constructor = module.AuthenticatedDataRightsStatusApplication as new (
      sessions: { introspectSession(cookie: string | undefined): Promise<unknown> },
      ledger: { getRequest(input: unknown): Promise<unknown> },
    ) => { getRequestStatus(cookie: string | undefined, requestId: string): Promise<unknown> };

    const introspectSession = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: SESSION,
    });
    const getRequest = vi.fn().mockResolvedValue({
      requestId: REQUEST_ID,
      workspaceId: SESSION.workspaceId,
      requestedByUserId: SESSION.userId,
      requestKind: 'export',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      requestDigest: 'a'.repeat(64),
      status: 'completed',
      receiptDigest: 'b'.repeat(64),
      requestedAt: '2026-08-10T00:01:00.000Z',
      completedAt: '2026-08-10T00:02:00.000Z',
    });
    const application = new Constructor({ introspectSession }, { getRequest });

    await expect(
      application.getRequestStatus('life_os_session=opaque', REQUEST_ID),
    ).resolves.toEqual({
      schemaVersion: 'life-os.data-rights-request-status.v1',
      requestId: REQUEST_ID,
      requestKind: 'export',
      status: 'completed',
      requestedAt: '2026-08-10T00:01:00.000Z',
      completedAt: '2026-08-10T00:02:00.000Z',
    });
    expect(introspectSession).toHaveBeenCalledWith('life_os_session=opaque');
    expect(getRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      workspaceId: SESSION.workspaceId,
      requestedByUserId: SESSION.userId,
    });
  });

  it('returns the same not-found class for absent and cross-tenant records', async () => {
    const module = await loadStatusModule();
    const Constructor = module.AuthenticatedDataRightsStatusApplication as new (
      sessions: { introspectSession(cookie: string | undefined): Promise<unknown> },
      ledger: { getRequest(input: unknown): Promise<unknown> },
    ) => { getRequestStatus(cookie: string | undefined, requestId: string): Promise<unknown> };
    const NotFound = module.DataRightsRequestNotFoundError as new () => Error;
    expect(typeof Constructor).toBe('function');
    expect(typeof NotFound).toBe('function');
    const application = new Constructor(
      {
        introspectSession: vi.fn().mockResolvedValue({ statusCode: 200, body: SESSION }),
      },
      { getRequest: vi.fn().mockResolvedValue(undefined) },
    );

    await expect(
      application.getRequestStatus(undefined, REQUEST_ID),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('does not invoke the ledger when authentication fails', async () => {
    const module = await loadStatusModule();
    const Constructor = module.AuthenticatedDataRightsStatusApplication as new (
      sessions: { introspectSession(cookie: string | undefined): Promise<unknown> },
      ledger: { getRequest(input: unknown): Promise<unknown> },
    ) => { getRequestStatus(cookie: string | undefined, requestId: string): Promise<unknown> };
    expect(typeof Constructor).toBe('function');
    const getRequest = vi.fn();
    const application = new Constructor(
      {
        introspectSession: vi
          .fn()
          .mockRejectedValue(new Error('Session is invalid or expired')),
      },
      { getRequest },
    );

    await expect(
      application.getRequestStatus(undefined, REQUEST_ID),
    ).rejects.toThrow('Session is invalid or expired');
    expect(getRequest).not.toHaveBeenCalled();
  });
});
