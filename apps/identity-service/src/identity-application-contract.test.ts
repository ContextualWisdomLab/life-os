import { describe, expect, it } from 'vitest';
import { IdentityService, InMemoryIdentityRepository } from './identity-domain';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('stable Identity application contract', () => {
  it('keeps provider input and user/workspace output names independent of PostgreSQL vocabulary', async () => {
    const identityService = new IdentityService(new InMemoryIdentityRepository());

    const account = await identityService.signInWithExternalIdentity({
      provider: 'github',
      providerSubject: '8172694',
      displayName: 'Example User',
    });

    expect(account.user.id).toMatch(UUID_V4_PATTERN);
    expect(account.externalIdentity.id).toMatch(UUID_V4_PATTERN);
    expect(account.externalIdentity.userId).toBe(account.user.id);
    expect(account.externalIdentity.provider).toBe('github');
    expect(account.workspace.id).toMatch(UUID_V4_PATTERN);
    expect(account.workspace.ownerUserId).toBe(account.user.id);
    expect(account.workspace.name).toBe("Example User's workspace");
    expect(account.workspace.kind).toBe('personal');
  });
});
