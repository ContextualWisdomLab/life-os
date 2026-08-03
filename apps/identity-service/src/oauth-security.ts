import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { IdentityProvider } from './identity-domain';

const DEFAULT_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

function createOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

function requireOpaqueIdentifier(value: string): string {
  const normalized = value.trim();
  if (!normalized || /^\d+$/.test(normalized)) {
    throw new Error('Identifier must be an opaque non-numeric string');
  }
  return normalized;
}

function requireText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function addMilliseconds(value: Date, milliseconds: number): Date {
  return new Date(value.getTime() + milliseconds);
}

export interface OAuthTransaction {
  id: string;
  stateHash: string;
  provider: IdentityProvider;
  browserSessionHash: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
}

export interface OAuthAuthorizationRequest {
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: string;
}

export interface VerifiedOAuthCallback {
  provider: IdentityProvider;
  codeVerifier: string;
  redirectUri: string;
}

export interface OAuthTransactionRepository {
  save(transaction: OAuthTransaction): void;
  findByStateHash(stateHash: string): OAuthTransaction | undefined;
  deleteByStateHash(stateHash: string): void;
}

export class InMemoryOAuthTransactionRepository implements OAuthTransactionRepository {
  private readonly transactions = new Map<string, OAuthTransaction>();

  save(transaction: OAuthTransaction): void {
    this.transactions.set(transaction.stateHash, transaction);
  }

  findByStateHash(stateHash: string): OAuthTransaction | undefined {
    return this.transactions.get(stateHash);
  }

  deleteByStateHash(stateHash: string): void {
    this.transactions.delete(stateHash);
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
    this.ttlMs = options.ttlMs ?? DEFAULT_OAUTH_TRANSACTION_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error('OAuth transaction TTL must be a positive integer');
    }
  }

  beginAuthorization(input: {
    provider: IdentityProvider;
    browserSessionId: string;
    redirectUri: string;
  }): OAuthAuthorizationRequest {
    const browserSessionId = requireOpaqueIdentifier(input.browserSessionId);
    const redirectUri = requireText(input.redirectUri, 'Redirect URI is required');
    const createdAt = this.now();
    const expiresAt = addMilliseconds(createdAt, this.ttlMs);
    const state = createOpaqueToken();
    const codeVerifier = createOpaqueToken();

    this.repository.save({
      id: randomUUID(),
      stateHash: sha256Base64Url(state),
      provider: input.provider,
      browserSessionHash: sha256Base64Url(browserSessionId),
      codeVerifier,
      redirectUri,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    return {
      state,
      codeChallenge: sha256Base64Url(codeVerifier),
      codeChallengeMethod: 'S256',
      expiresAt: expiresAt.toISOString(),
    };
  }

  consumeCallback(input: {
    provider: IdentityProvider;
    browserSessionId: string;
    state: string;
  }): VerifiedOAuthCallback {
    const state = requireText(input.state, 'OAuth state is required');
    const browserSessionId = requireOpaqueIdentifier(input.browserSessionId);
    const stateHash = sha256Base64Url(state);
    const transaction = this.repository.findByStateHash(stateHash);

    if (!transaction) {
      throw new Error('OAuth transaction is invalid or already consumed');
    }

    if (
      transaction.provider !== input.provider ||
      transaction.browserSessionHash !== sha256Base64Url(browserSessionId)
    ) {
      throw new Error('OAuth transaction binding mismatch');
    }

    if (this.now().getTime() >= new Date(transaction.expiresAt).getTime()) {
      this.repository.deleteByStateHash(stateHash);
      throw new Error('OAuth transaction expired');
    }

    this.repository.deleteByStateHash(stateHash);
    return {
      provider: transaction.provider,
      codeVerifier: transaction.codeVerifier,
      redirectUri: transaction.redirectUri,
    };
  }
}

export interface Session {
  id: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  rotatedFromId?: string;
}

export interface IssuedSession {
  token: string;
  session: Session;
}

export interface SessionRepository {
  save(session: Session): void;
  findByTokenHash(tokenHash: string): Session | undefined;
  revokeByTokenHash(tokenHash: string, revokedAt: string): void;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, Session>();

  save(session: Session): void {
    this.sessions.set(session.tokenHash, session);
  }

  findByTokenHash(tokenHash: string): Session | undefined {
    return this.sessions.get(tokenHash);
  }

  revokeByTokenHash(tokenHash: string, revokedAt: string): void {
    const session = this.sessions.get(tokenHash);
    if (session && !session.revokedAt) {
      this.sessions.set(tokenHash, { ...session, revokedAt });
    }
  }

  containsRawToken(token: string): boolean {
    return [...this.sessions.entries()].some(
      ([key, session]) => key === token || Object.values(session).includes(token),
    );
  }
}

export class SessionService {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(
    private readonly repository: SessionRepository,
    options: { now?: () => Date; ttlMs?: number } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error('Session TTL must be a positive integer');
    }
  }

  issue(input: { userId: string; workspaceId: string }): IssuedSession {
    return this.issueInternal(input, undefined);
  }

  authenticate(token: string): Session | undefined {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return undefined;
    }

    const session = this.repository.findByTokenHash(sha256Base64Url(normalizedToken));
    if (!session || session.revokedAt) {
      return undefined;
    }

    if (this.now().getTime() >= new Date(session.expiresAt).getTime()) {
      return undefined;
    }

    return session;
  }

  rotate(token: string): IssuedSession {
    const current = this.authenticate(token);
    if (!current) {
      throw new Error('Session not found');
    }

    this.repository.revokeByTokenHash(current.tokenHash, this.now().toISOString());
    return this.issueInternal(
      { userId: current.userId, workspaceId: current.workspaceId },
      current.id,
    );
  }

  revoke(token: string): void {
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      return;
    }
    this.repository.revokeByTokenHash(
      sha256Base64Url(normalizedToken),
      this.now().toISOString(),
    );
  }

  private issueInternal(
    input: { userId: string; workspaceId: string },
    rotatedFromId: string | undefined,
  ): IssuedSession {
    const userId = requireOpaqueIdentifier(input.userId);
    const workspaceId = requireOpaqueIdentifier(input.workspaceId);
    const token = createOpaqueToken();
    const createdAt = this.now();
    const session: Session = {
      id: randomUUID(),
      userId,
      workspaceId,
      tokenHash: sha256Base64Url(token),
      createdAt: createdAt.toISOString(),
      expiresAt: addMilliseconds(createdAt, this.ttlMs).toISOString(),
      ...(rotatedFromId ? { rotatedFromId } : {}),
    };

    this.repository.save(session);
    return { token, session };
  }
}
