import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IdentityProvider } from './identity-domain';
import { requireSafeRedirectUri } from './oauth-redirect-uri';

const INVALID_OAUTH_TRANSACTION = 'OAuth transaction is invalid or no longer active';
const INVALID_SESSION = 'Session is invalid or expired';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type MaybePromise<T> = T | Promise<T>;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function createOpaqueSecret(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function requireOpaqueIdentifier(value: string): string {
  const normalized = value.trim();
  if (!normalized || /^\d+$/.test(normalized)) {
    throw new Error('Identifier must be an opaque non-numeric string');
  }
  return normalized;
}

function requirePositiveTtl(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(message);
  }
  return value;
}

export function requireIdentityProvider(value: unknown): IdentityProvider {
  if (value !== 'google' && value !== 'github') {
    throw new Error('Unsupported identity provider');
  }
  return value;
}

export interface OAuthTransactionBinding {
  browserSessionId: string;
  redirectUri: string;
}

export interface OAuthTransactionStart {
  id: string;
  provider: IdentityProvider;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  redirectUri: string;
  nonce?: string;
  expiresAt: string;
}

export interface ConsumedOAuthTransaction {
  id: string;
  provider: IdentityProvider;
  codeVerifier: string;
  redirectUri: string;
  nonce?: string;
}

export interface StoredOAuthTransaction {
  id: string;
  provider: IdentityProvider;
  stateHash: string;
  browserSessionHash: string;
  codeVerifier: string;
  redirectUri: string;
  nonce: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface OAuthTransactionRepository {
  save(transaction: StoredOAuthTransaction): MaybePromise<void>;
  consumeByStateHash(
    provider: IdentityProvider,
    stateHash: string,
    browserSessionHash: string,
    consumedAt: string,
  ): MaybePromise<StoredOAuthTransaction | undefined>;
}

export class InMemoryOAuthTransactionRepository implements OAuthTransactionRepository {
  private readonly transactions = new Map<string, StoredOAuthTransaction>();

  save(transaction: StoredOAuthTransaction): void {
    this.transactions.set(transaction.stateHash, { ...transaction });
  }

  consumeByStateHash(
    provider: IdentityProvider,
    stateHash: string,
    browserSessionHash: string,
    consumedAt: string,
  ): StoredOAuthTransaction | undefined {
    const transaction = this.transactions.get(stateHash);
    if (
      !transaction ||
      transaction.provider !== provider ||
      transaction.browserSessionHash !== browserSessionHash ||
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
    this.ttlMs = requirePositiveTtl(
      options.ttlMs ?? DEFAULT_OAUTH_TRANSACTION_TTL_MS,
      'OAuth transaction TTL must be a positive integer',
    );
  }

  async begin(
    providerValue: IdentityProvider,
    binding: OAuthTransactionBinding,
  ): Promise<OAuthTransactionStart> {
    const provider = requireIdentityProvider(providerValue);
    const browserSessionId = requireOpaqueIdentifier(binding.browserSessionId);
    const redirectUri = requireSafeRedirectUri(binding.redirectUri);
    const now = this.now();
    const state = createOpaqueSecret(32);
    const codeVerifier = createOpaqueSecret(64);
    const nonce = provider === 'google' ? createOpaqueSecret(32) : null;
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();
    const transaction: StoredOAuthTransaction = {
      id: randomUUID(),
      provider,
      stateHash: sha256Hex(state),
      browserSessionHash: sha256Hex(browserSessionId),
      codeVerifier,
      redirectUri,
      nonce,
      createdAt: now.toISOString(),
      expiresAt,
      consumedAt: null,
    };

    await this.repository.save(transaction);
    return {
      id: transaction.id,
      provider,
      state,
      codeChallenge: sha256Base64Url(codeVerifier),
      codeChallengeMethod: 'S256',
      redirectUri,
      ...(nonce ? { nonce } : {}),
      expiresAt,
    };
  }

  async consume(
    providerValue: IdentityProvider,
    state: string,
    browserSessionIdValue: string,
  ): Promise<ConsumedOAuthTransaction> {
    const provider = requireIdentityProvider(providerValue);
    const browserSessionId = requireOpaqueIdentifier(browserSessionIdValue);
    const transaction =
      typeof state === 'string' && state
        ? await this.repository.consumeByStateHash(
            provider,
            sha256Hex(state),
            sha256Hex(browserSessionId),
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
      redirectUri: transaction.redirectUri,
      ...(transaction.nonce ? { nonce: transaction.nonce } : {}),
    };
  }
}

export interface SessionRecord {
  id: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  rotatedFromId: string | null;
}

export interface ActiveSession {
  id: string;
  userId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
  rotatedFromId?: string;
}

export interface SessionRepository {
  save(session: SessionRecord): MaybePromise<void>;
  findByTokenHash(tokenHash: string): MaybePromise<SessionRecord | undefined>;
  revokeByTokenHash(tokenHash: string, revokedAt: string): MaybePromise<boolean>;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, SessionRecord>();

  save(session: SessionRecord): void {
    this.sessions.set(session.tokenHash, { ...session });
  }

  findByTokenHash(tokenHash: string): SessionRecord | undefined {
    const session = this.sessions.get(tokenHash);
    return session ? { ...session } : undefined;
  }

  revokeByTokenHash(tokenHash: string, revokedAt: string): boolean {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt !== null) {
      return false;
    }

    this.sessions.set(tokenHash, { ...session, revokedAt });
    return true;
  }
}

function toActiveSession(session: SessionRecord): ActiveSession {
  return {
    id: session.id,
    userId: session.userId,
    workspaceId: session.workspaceId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    ...(session.rotatedFromId ? { rotatedFromId: session.rotatedFromId } : {}),
  };
}

export class SessionService {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(
    private readonly repository: SessionRepository,
    options: { now?: () => Date; ttlMs?: number } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = requirePositiveTtl(
      options.ttlMs ?? DEFAULT_SESSION_TTL_MS,
      'Session TTL must be a positive integer',
    );
  }

  async create(
    userId: string,
    workspaceId: string,
  ): Promise<{ session: ActiveSession; token: string }> {
    return this.issue(userId, workspaceId, null);
  }

  async authenticate(token: string): Promise<ActiveSession> {
    return toActiveSession(await this.requireActiveRecord(token));
  }

  async rotate(token: string): Promise<{ session: ActiveSession; token: string }> {
    const current = await this.requireActiveRecord(token);
    if (!(await this.repository.revokeByTokenHash(current.tokenHash, this.now().toISOString()))) {
      throw new Error(INVALID_SESSION);
    }
    return this.issue(current.userId, current.workspaceId, current.id);
  }

  async revoke(token: string): Promise<void> {
    if (typeof token !== 'string' || !token) {
      return;
    }
    await this.repository.revokeByTokenHash(sha256Hex(token), this.now().toISOString());
  }

  private async issue(
    userId: string,
    workspaceId: string,
    rotatedFromId: string | null,
  ): Promise<{ session: ActiveSession; token: string }> {
    if (!UUID_V4_PATTERN.test(userId)) {
      throw new Error('User ID must be an opaque UUIDv4');
    }
    if (!UUID_V4_PATTERN.test(workspaceId)) {
      throw new Error('Workspace ID must be an opaque UUIDv4');
    }

    const now = this.now();
    const token = createOpaqueSecret(32);
    const record: SessionRecord = {
      id: randomUUID(),
      userId,
      workspaceId,
      tokenHash: sha256Hex(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      revokedAt: null,
      rotatedFromId,
    };

    await this.repository.save(record);
    return { session: toActiveSession(record), token };
  }

  private async requireActiveRecord(token: string): Promise<SessionRecord> {
    const now = this.now();
    const record =
      typeof token === 'string' && token
        ? await this.repository.findByTokenHash(sha256Hex(token))
        : undefined;

    if (!record || record.revokedAt !== null || Date.parse(record.expiresAt) <= now.getTime()) {
      throw new Error(INVALID_SESSION);
    }
    return record;
  }
}
