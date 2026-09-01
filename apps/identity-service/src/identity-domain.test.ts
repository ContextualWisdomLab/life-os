import { describe, expect, it } from 'vitest';
import {
  IdentityService,
  InMemoryIdentityRepository,
  type IdentityProvider,
} from './identity-domain';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('IdentityService', () => {
  it('provisions one user and one personal workspace for a new external identity', async () => {
    const service = new IdentityService(new InMemoryIdentityRepository());

    const account = await service.signInWithExternalIdentity({
      provider: 'github',
      providerSubject: '8172694',
      displayName: 'Example User',
    });

    expect(account.user.id).toMatch(UUID_V4_PATTERN);
    expect(account.workspace.id).toMatch(UUID_V4_PATTERN);
    expect(account.user.id).not.toBe(account.workspace.id);
    expect(account.workspace.ownerUserId).toBe(account.user.id);
  });

  it('reuses the same internal account for repeated sign-in', async () => {
    const service = new IdentityService(new InMemoryIdentityRepository());
    const input = {
      provider: 'google' as const,
      providerSubject: 'external-subject-123',
      displayName: 'Example User',
    };

    const first = await service.signInWithExternalIdentity(input);
    const second = await service.signInWithExternalIdentity(input);

    expect(second).toEqual(first);
  });

  it('returns one account when first sign-ins race', async () => {
    const service = new IdentityService(new InMemoryIdentityRepository());
    const input = {
      provider: 'github' as const,
      providerSubject: 'concurrent-subject',
      displayName: 'Concurrent User',
    };

    const [first, second] = await Promise.all([
      service.signInWithExternalIdentity(input),
      service.signInWithExternalIdentity(input),
    ]);

    expect(second).toEqual(first);
  });

  it('keeps provider subjects separate from internal identifiers', async () => {
    const service = new IdentityService(new InMemoryIdentityRepository());
    const account = await service.signInWithExternalIdentity({
      provider: 'github',
      providerSubject: '123456',
      displayName: 'Example User',
    });

    expect(account.user.id).not.toBe('123456');
    expect(account.externalIdentity.providerSubject).toBe('123456');
  });

  it('rejects unsupported providers and empty required attributes', async () => {
    const service = new IdentityService(new InMemoryIdentityRepository());

    await expect(
      service.signInWithExternalIdentity({
        provider: 'gitlab' as IdentityProvider,
        providerSubject: 'subject',
        displayName: 'Example User',
      }),
    ).rejects.toThrowError('Unsupported identity provider');

    await expect(
      service.signInWithExternalIdentity({
        provider: 'google',
        providerSubject: '   ',
        displayName: 'Example User',
      }),
    ).rejects.toThrowError('Provider subject is required');

    await expect(
      service.signInWithExternalIdentity({
        provider: 'google',
        providerSubject: 'subject',
        displayName: '   ',
      }),
    ).rejects.toThrowError('Display name is required');
  });
});
