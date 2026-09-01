import { randomUUID } from 'node:crypto';

export type IdentityProvider = 'google' | 'github';
export type MaybePromise<T> = T | Promise<T>;

export interface UserAccount {
  userAccountId: string;
  displayName: string;
  createdAt: string;
}

export interface ExternalIdentity {
  externalIdentityId: string;
  userAccountId: string;
  identityProvider: IdentityProvider;
  providerSubject: string;
  createdAt: string;
}

export interface IdentityWorkspace {
  identityWorkspaceId: string;
  ownerUserAccountId: string;
  workspaceName: string;
  workspaceKind: 'personal';
  createdAt: string;
}

export interface ProvisionedAccount {
  userAccount: UserAccount;
  externalIdentity: ExternalIdentity;
  identityWorkspace: IdentityWorkspace;
}

export interface IdentityRepository {
  findByExternalIdentity(
    identityProvider: IdentityProvider,
    providerSubject: string,
  ): MaybePromise<ProvisionedAccount | undefined>;
  save(provisionedAccount: ProvisionedAccount): MaybePromise<ProvisionedAccount>;
}

function cloneAccount(provisionedAccount: ProvisionedAccount): ProvisionedAccount {
  return {
    userAccount: { ...provisionedAccount.userAccount },
    externalIdentity: { ...provisionedAccount.externalIdentity },
    identityWorkspace: { ...provisionedAccount.identityWorkspace },
  };
}

export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly provisionedAccounts = new Map<string, ProvisionedAccount>();

  findByExternalIdentity(
    identityProvider: IdentityProvider,
    providerSubject: string,
  ): ProvisionedAccount | undefined {
    const externalIdentityKey = `${identityProvider}:${providerSubject}`;
    const provisionedAccount = this.provisionedAccounts.get(externalIdentityKey);
    return provisionedAccount ? cloneAccount(provisionedAccount) : undefined;
  }

  save(provisionedAccount: ProvisionedAccount): ProvisionedAccount {
    const { identityProvider, providerSubject } = provisionedAccount.externalIdentity;
    const externalIdentityKey = `${identityProvider}:${providerSubject}`;
    const existingAccount = this.provisionedAccounts.get(externalIdentityKey);
    if (existingAccount) {
      return cloneAccount(existingAccount);
    }

    const storedAccount = cloneAccount(provisionedAccount);
    this.provisionedAccounts.set(externalIdentityKey, storedAccount);
    return cloneAccount(storedAccount);
  }
}

function requireProvider(identityProvider: IdentityProvider): IdentityProvider {
  if (identityProvider !== 'google' && identityProvider !== 'github') {
    throw new Error('Unsupported identity provider');
  }
  return identityProvider;
}

function requireText(textValue: string, errorMessage: string): string {
  const normalizedText = textValue.trim();
  if (!normalizedText) {
    throw new Error(errorMessage);
  }
  return normalizedText;
}

function createOpaqueId(): string {
  return randomUUID();
}

export class IdentityService {
  constructor(private readonly identityRepository: IdentityRepository) {}

  async signInWithExternalIdentity(identityInput: {
    identityProvider: IdentityProvider;
    providerSubject: string;
    displayName: string;
  }): Promise<ProvisionedAccount> {
    const identityProvider = requireProvider(identityInput.identityProvider);
    const providerSubject = requireText(
      identityInput.providerSubject,
      'Provider subject is required',
    );
    const existingAccount = await this.identityRepository.findByExternalIdentity(
      identityProvider,
      providerSubject,
    );
    if (existingAccount) {
      return existingAccount;
    }

    const createdAt = new Date().toISOString();
    const userAccount: UserAccount = {
      userAccountId: createOpaqueId(),
      displayName: requireText(identityInput.displayName, 'Display name is required'),
      createdAt,
    };
    const provisionedAccount: ProvisionedAccount = {
      userAccount,
      externalIdentity: {
        externalIdentityId: createOpaqueId(),
        userAccountId: userAccount.userAccountId,
        identityProvider,
        providerSubject,
        createdAt,
      },
      identityWorkspace: {
        identityWorkspaceId: createOpaqueId(),
        ownerUserAccountId: userAccount.userAccountId,
        workspaceName: `${userAccount.displayName}'s workspace`,
        workspaceKind: 'personal',
        createdAt,
      },
    };

    return await this.identityRepository.save(provisionedAccount);
  }
}
