import { randomUUID } from 'node:crypto';

export type IdentityProvider = 'google' | 'github';
export type MaybePromise<T> = T | Promise<T>;

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
  ): MaybePromise<ProvisionedAccount | undefined>;
  save(account: ProvisionedAccount): MaybePromise<ProvisionedAccount>;
}

function cloneAccount(account: ProvisionedAccount): ProvisionedAccount {
  return {
    user: { ...account.user },
    externalIdentity: { ...account.externalIdentity },
    workspace: { ...account.workspace },
  };
}

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly accounts = new Map<string, ProvisionedAccount>();

  findByExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): ProvisionedAccount | undefined {
    const account = this.accounts.get(`${provider}:${providerSubject}`);
    return account ? cloneAccount(account) : undefined;
  }

  save(account: ProvisionedAccount): ProvisionedAccount {
    const { provider, providerSubject } = account.externalIdentity;
    const key = `${provider}:${providerSubject}`;
    const existing = this.accounts.get(key);
    if (existing) {
      return cloneAccount(existing);
    }

    const stored = cloneAccount(account);
    this.accounts.set(key, stored);
    return cloneAccount(stored);
  }
}

function requireProvider(value: IdentityProvider): IdentityProvider {
  if (value !== 'google' && value !== 'github') {
    throw new Error('Unsupported identity provider');
  }
  return value;
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

  async signInWithExternalIdentity(input: {
    provider: IdentityProvider;
    providerSubject: string;
    displayName: string;
  }): Promise<ProvisionedAccount> {
    const provider = requireProvider(input.provider);
    const providerSubject = requireText(input.providerSubject, 'Provider subject is required');
    const existing = await this.repository.findByExternalIdentity(provider, providerSubject);
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
        provider,
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

    return await this.repository.save(account);
  }
}
