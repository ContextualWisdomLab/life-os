import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IdentityProvider } from './identity-domain';

const INVALID_OAUTH_TRANSACTION = 'OAuth transaction is invalid or no longer active';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function createOpaqueSecret(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export interface StoredOAuthTransaction {
  id: string;
  provider: IdentityProvider;
  stateHash: string;
  codeVerifier: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OAuthTransactionRepository {
  save(transaction: StoredOAuthTransaction): void;
  consumeByStateHash(
    provider: IdentityProvider,
    stateHash: string,
    consumedAt: string,
  ): StoredOAuthTransaction | undefined;
}

export class InMemoryOAuthTransactionRepository implements OAuthTransactionRepository {
  private readonly transactions = new Map<string, StoredOAuthTransaction>();

  save(transaction: StoredOAuthTransaction): void {
    this.transactions.set(transaction.stateHash, { ...transaction });
  }

  consumeByStateHash(
    provider: IdentityProvider,
    stateHash: string,
    consumedAt: string,
  ): StoredOAuthTransaction | undefined {
    const transaction = this.transactions.get(stateHash);
    if (
      !transaction ||
      transaction.provider !== provider ||
      transaction.consumedAt !== null ||
      Date.parse(transaction.expiresAt) <= Date.parse(consumedAt)
    ) {
      return undefined;
    }
    const consumed = { ...transaction, consumedAt };
    this.transactions.set(stateHash, consumed);
    return { ...consumed };
  }
}

export class OAuthTransactionService {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(
    private readonly repository: OAuthTransactionRepository,
    options: { now?: () => Date; ttlMs?: number } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  }

  begin(provider: IdentityProvider): {
    id: string;
    provider: IdentityProvider;
    state: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    expiresAt: string;
  } {
    const now = this.now();
    const state = createOpaqueSecret(32);
    const codeVerifier = createOpaqueSecret(64);
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
    const transaction: StoredOAuthTransaction = {
      id: randomUUID(),
      provider,
      stateHash: sha256Hex(state),
      codeVerifier,
      createdAt: now.toISOString(),
      expiresAt,
      consumedAt: null,
    };
    this.repository.save(transaction);
    return {
      id: transaction.id,
      provider,
      state,
      codeChallenge: sha256Base64Url(codeVerifier),
      codeChallengeMethod: 'S256',
      expiresAt,
    };
  }

  consume(provider: IdentityProvider, state: string): {
    id: string;
    provider: IdentityProvider;
    codeVerifier: string;
  } {
    const transaction =
      typeof state === 'string' && state
        ? this.repository.consumeByStateHash(
            provider,
            sha256Hex(state),
            this.now().toISOString(),
          )
        : undefined;
    if (!transaction) {
      throw new Error(INVALID_OAUTH_TRANSACTION);
    }
    return {
      id: transaction.id,
      provider: transaction.provider,
      codeVerifier: transaction.codeVerifier,
    };
  }
}
