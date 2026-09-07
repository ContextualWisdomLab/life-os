import { randomUUID } from 'node:crypto';

/** Supported upstream identity providers exposed by the stable application contract. */
export type IdentityProvider = 'google' | 'github';

/** Allows repository ports to stay synchronous in tests and asynchronous in production. */
export type MaybePromise<T> = T | Promise<T>;

/** Stable application-level user identity independent of PostgreSQL column names. */
export interface User {
  id: string;
  displayName: string;
  createdAt: string;
}

/** External provider binding owned by the Identity bounded context. */
export interface ExternalIdentity {
  id: string;
  userId: string;
  provider: IdentityProvider;
  providerSubject: string;
  createdAt: string;
}

/** Personal workspace provisioned atomically with the first external sign-in. */
export interface Workspace {
  id: string;
  ownerUserId: string;
  name: string;
  kind: 'personal';
  createdAt: string;
}

/** Stable account aggregate returned to application consumers after provisioning. */
export interface ProvisionedAccount {
  user: User;
  externalIdentity: ExternalIdentity;
  workspace: Workspace;
}

/** Persistence port that preserves external-identity uniqueness and account idempotency. */
export interface IdentityRepository {
  /** Finds the one account bound to a provider subject, or returns no match. */
  findByExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): MaybePromise<ProvisionedAccount | undefined>;

  /** Persists one proposed aggregate and returns the authoritative stored account. */
  save(account: ProvisionedAccount): MaybePromise<ProvisionedAccount>;
}

/** Copies an account so the in-memory adapter never leaks mutable stored references. */
function cloneAccount(account: ProvisionedAccount): ProvisionedAccount {
  return {
    user: { ...account.user },
    externalIdentity: { ...account.externalIdentity },
    workspace: { ...account.workspace },
  };
}

/** Deterministic repository adapter used by domain tests without PostgreSQL side effects. */
export class InMemoryIdentityRepository implements IdentityRepository {
  private readonly accounts = new Map<string, ProvisionedAccount>();

  /** Returns a defensive copy for the exact provider-subject identity key. */
  findByExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): ProvisionedAccount | undefined {
    const account = this.accounts.get(`${provider}:${providerSubject}`);
    return account ? cloneAccount(account) : undefined;
  }

  /** Stores the first account for an identity key and replays that account thereafter. */
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

/** Rejects providers outside the stable Google/GitHub application contract. */
function requireProvider(value: IdentityProvider): IdentityProvider {
  if (value !== 'google' && value !== 'github') {
    throw new Error('Unsupported identity provider');
  }
  return value;
}

/** Normalizes required user-facing text and rejects blank values. */
function requireText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

/** Creates a non-sequential UUIDv4 for public and internal product identity. */
function createOpaqueId(): string {
  return randomUUID();
}

/**
 * Provisions the Identity aggregate for an authenticated external subject.
 * Existing bindings are replayed unchanged; new user, external-identity, and
 * personal-workspace identities are proposed together and delegated to the
 * repository for durable uniqueness and transaction semantics.
 */
export class IdentityService {
  constructor(private readonly repository: IdentityRepository) {}

  /**
   * Signs in one supported provider subject without exposing persistence names.
   * Unsupported providers and empty subjects always fail before repository mutation.
   * A display name is required only when no durable binding exists; replay returns the
   * authoritative stored account unchanged and deliberately ignores profile-name drift.
   */
  async signInWithExternalIdentity(input: {
    provider: IdentityProvider;
    providerSubject: string;
    displayName: string;
  }): Promise<ProvisionedAccount> {
    const provider = requireProvider(input.provider);
    const providerSubject = requireText(
      input.providerSubject,
      'Provider subject is required',
    );
    const existing = await this.repository.findByExternalIdentity(
      provider,
      providerSubject,
    );
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
