import { describe, expect, it } from 'vitest';
import {
  IdentityService,
  InMemoryIdentityRepository,
  type IdentityProvider,
} from './identity-domain';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('IdentityService', () => {
  it('provisions one user account and one personal identity workspace for a new external identity', async () => {
    const identityService = new IdentityService(new InMemoryIdentityRepository());

    const provisionedAccount = await identityService.signInWithExternalIdentity({
      identityProvider: 'github',
      providerSubject: '8172694',
      displayName: 'Example User',
    });

    expect(provisionedAccount.userAccount.userAccountId).toMatch(UUID_V4_PATTERN);
    expect(provisionedAccount.identityWorkspace.identityWorkspaceId).toMatch(
      UUID_V4_PATTERN,
    );
    expect(provisionedAccount.userAccount.userAccountId).not.toBe(
      provisionedAccount.identityWorkspace.identityWorkspaceId,
    );
    expect(provisionedAccount.identityWorkspace.ownerUserAccountId).toBe(
      provisionedAccount.userAccount.userAccountId,
    );
  });

  it('reuses the same internal account for repeated sign-in', async () => {
    const identityService = new IdentityService(new InMemoryIdentityRepository());
    const identityInput = {
      identityProvider: 'google' as const,
      providerSubject: 'external-subject-123',
      displayName: 'Example User',
    };

    const firstAccount = await identityService.signInWithExternalIdentity(identityInput);
    const secondAccount = await identityService.signInWithExternalIdentity(identityInput);

    expect(secondAccount).toEqual(firstAccount);
  });

  it('returns one account when first sign-ins race', async () => {
    const identityService = new IdentityService(new InMemoryIdentityRepository());
    const identityInput = {
      identityProvider: 'github' as const,
      providerSubject: 'concurrent-subject',
      displayName: 'Concurrent User',
    };

    const [firstAccount, secondAccount] = await Promise.all([
      identityService.signInWithExternalIdentity(identityInput),
      identityService.signInWithExternalIdentity(identityInput),
    ]);

    expect(secondAccount).toEqual(firstAccount);
  });

  it('keeps provider subjects separate from internal identifiers', async () => {
    const identityService = new IdentityService(new InMemoryIdentityRepository());
    const provisionedAccount = await identityService.signInWithExternalIdentity({
      identityProvider: 'github',
      providerSubject: '123456',
      displayName: 'Example User',
    });

    expect(provisionedAccount.userAccount.userAccountId).not.toBe('123456');
    expect(provisionedAccount.externalIdentity.providerSubject).toBe('123456');
  });

  it('rejects unsupported providers and empty required attributes', async () => {
    const identityService = new IdentityService(new InMemoryIdentityRepository());

    await expect(
      identityService.signInWithExternalIdentity({
        identityProvider: 'gitlab' as IdentityProvider,
        providerSubject: 'subject',
        displayName: 'Example User',
      }),
    ).rejects.toThrowError('Unsupported identity provider');

    await expect(
      identityService.signInWithExternalIdentity({
        identityProvider: 'google',
        providerSubject: '   ',
        displayName: 'Example User',
      }),
    ).rejects.toThrowError('Provider subject is required');

    await expect(
      identityService.signInWithExternalIdentity({
        identityProvider: 'google',
        providerSubject: 'subject',
        displayName: '   ',
      }),
    ).rejects.toThrowError('Display name is required');
  });
});
