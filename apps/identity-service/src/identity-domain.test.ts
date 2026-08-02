import { describe, expect, it } from 'vitest';
import { IdentityService, InMemoryIdentityRepository } from './identity-domain';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('IdentityService', () => {
  it('provisions one user and one personal workspace for a new external identity', () => {
    const service = new IdentityService(new InMemoryIdentityRepository());

    const account = service.signInWithExternalIdentity({
      provider: 'github',
      providerSubject: '8172694',
      displayName: 'Example User',
    });

    expect(account.user.id).toMatch(UUID_V4_PATTERN);
    expect(account.workspace.id).toMatch(UUID_V4_PATTERN);
    expect(account.user.id).not.toBe(account.workspace.id);
    expect(account.workspace.ownerUserId).toBe(account.user.id);
  });

  it('reuses the same internal account for repeated sign-in', () => {
    const service = new IdentityService(new InMemoryIdentityRepository());
    const input = {
      provider: 'google' as const,
      providerSubject: 'external-subject-123',
      displayName: 'Example User',
    };

    const first = service.signInWithExternalIdentity(input);
    const second = service.signInWithExternalIdentity(input);

    expect(second).toEqual(first);
  });

  it('keeps provider subjects separate from internal identifiers', () => {
    const service = new IdentityService(new InMemoryIdentityRepository());
    const account = service.signInWithExternalIdentity({
      provider: 'github',
      providerSubject: '123456',
      displayName: 'Example User',
    });

    expect(account.user.id).not.toBe('123456');
    expect(account.externalIdentity.providerSubject).toBe('123456');
  });

  it('rejects an empty provider subject', () => {
    const service = new IdentityService(new InMemoryIdentityRepository());

    expect(() =>
      service.signInWithExternalIdentity({
        provider: 'google',
        providerSubject: '   ',
        displayName: 'Example User',
      }),
    ).toThrowError('Provider subject is required');
  });
});
