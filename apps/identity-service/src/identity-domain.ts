import { randomUUID } from 'node:crypto';

export type IdentityProvider = 'google' | 'github';

export interface User {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: IdentityProvider;
  providerSubject: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  ownerUserId: string;
  name: string;
  kind: 'personal';
  createdAt: string;
}

export interface ProvisionedAccount {
  user: User;
  externalIdentity: ExternalIdentity;
  workspace: Workspace;
}

export interface IdentityRepository {
  findByExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): ProvisionedAccount | undefined;
  save(account: ProvisionedAccount): void;
}

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly accounts = new Map<string, ProvisionedAccount>();

  findByExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): ProvisionedAccount | undefined {
    return this.accounts.get(`${provider}:${providerSubject}`);
  }

  save(account: ProvisionedAccount): void {
    const { provider, providerSubject } = account.externalIdentity;
    this.accounts.set(`${provider}:${providerSubject}`, account);
  }
}

function requireText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function createOpaqueId(): string {
  return randomUUID();
}

export class IdentityService {
  constructor(private readonly repository: IdentityRepository) {}

  signInWithExternalIdentity(input: {
    provider: IdentityProvider;
    providerSubject: string;
    displayName: string;
  }): ProvisionedAccount {
    const providerSubject = requireText(input.providerSubject, 'Provider subject is required');
    const existing = this.repository.findByExternalIdentity(input.provider, providerSubject);
    if (existing) {
      return existing;
    }

    const createdAt = new Date().toISOString();
    const user: User = {
      id: createOpaqueId(),
      displayName: requireText(input.displayName, 'Display name is required'),
      createdAt,
    };
    const account: ProvisionedAccount = {
      user,
      externalIdentity: {
        id: createOpaqueId(),
        userId: user.id,
        provider: input.provider,
        providerSubject,
        createdAt,
      },
      workspace: {
        id: createOpaqueId(),
        ownerUserId: user.id,
        name: `${user.displayName}'s workspace`,
        kind: 'personal',
        createdAt,
      },
    };

    this.repository.save(account);
    return account;
  }
}
