import { describe, expect, it } from 'vitest';
import { InMemorySessionRepository, SessionService } from './auth-security';
import { toSessionView } from './oauth-http-boundary';

const USER_ID = 'a89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac1';
const WORKSPACE_ID = 'b89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac2';

describe('session authentication age provenance', () => {
  it('records the authentication instant separately from session issuance', async () => {
    const authenticatedAt = new Date('2026-08-09T12:00:00.000Z');
    const service = new SessionService(new InMemorySessionRepository(), {
      now: () => authenticatedAt,
    });

    const issued = await service.create(USER_ID, WORKSPACE_ID);

    expect(issued.session.authenticatedAt).toBe(authenticatedAt.toISOString());
    expect(issued.session.createdAt).toBe(authenticatedAt.toISOString());
    expect(toSessionView(issued.session)).toMatchObject({
      authenticatedAt: authenticatedAt.toISOString(),
    });
  });

  it('preserves the original authentication instant across session rotation', async () => {
    let now = new Date('2026-08-09T12:00:00.000Z');
    const service = new SessionService(new InMemorySessionRepository(), {
      now: () => now,
    });
    const issued = await service.create(USER_ID, WORKSPACE_ID);

    now = new Date('2026-08-09T12:30:00.000Z');
    const rotated = await service.rotate(issued.token);

    expect(rotated.session.createdAt).toBe(now.toISOString());
    expect(rotated.session.authenticatedAt).toBe(
      issued.session.authenticatedAt,
    );
    expect(rotated.session.authenticatedAt).not.toBe(rotated.session.createdAt);
  });
});
