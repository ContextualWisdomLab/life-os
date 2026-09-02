import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { TrustedCalendarUserContext } from './calendar-service-context';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const AUTHORIZATION_STATE_LIFETIME_MILLISECONDS = 5 * 60 * 1000;
const PURPOSE = 'google_calendar_oauth_authorization' as const;

/** Durable, credential-free authority record for one pending Google Calendar OAuth ceremony. */
export interface CalendarGoogleOAuthAuthorizationStateRecord {
  readonly stateId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly purpose: typeof PURPOSE;
  readonly redirectUri: string;
  readonly verifierSecretReference: string;
  readonly codeChallenge: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

/**
 * Calendar-owned persistence boundary for OAuth state.
 *
 * `consumeAuthorizationState` must atomically match state, workspace, user,
 * redirect URI, unconsumed status, and expiry before setting `consumedAt`.
 * Returning the same state twice is a persistence-contract violation.
 */
export interface CalendarGoogleOAuthAuthorizationStateRepository {
  createAuthorizationState(
    record: CalendarGoogleOAuthAuthorizationStateRecord,
  ): Promise<CalendarGoogleOAuthAuthorizationStateRecord>;
  consumeAuthorizationState(input: {
    readonly stateId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly redirectUri: string;
    readonly consumedAt: string;
  }): Promise<CalendarGoogleOAuthAuthorizationStateRecord | null>;
}

/** Secret-store boundary that keeps the PKCE verifier out of Calendar persistence. */
export interface CalendarGoogleOAuthVerifierSecretStore {
  writeVerifier(input: {
    readonly stateId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly verifier: string;
  }): Promise<string>;
  readVerifier(secretReference: string): Promise<string>;
  deleteVerifier(secretReference: string): Promise<void>;
}

/** Credential-free browser-facing authorization-start result. */
export interface CalendarGoogleOAuthAuthorizationIssueResult {
  readonly state: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
  readonly expiresAt: string;
}

/** Internal callback material; this value must never enter logs or public responses. */
export interface CalendarGoogleOAuthAuthorizationConsumeResult {
  readonly codeVerifier: string;
}

/** Rejects malformed, expired, replayed, cross-scope, or redirect-confused OAuth authority. */
export class CalendarGoogleOAuthAuthorizationValidationError extends Error {
  /** Creates a fixed validation failure without reflecting attacker-controlled state. */
  constructor() {
    super('Google Calendar OAuth authorization state is invalid');
    this.name = 'CalendarGoogleOAuthAuthorizationValidationError';
  }
}

/** Rejects unavailable or contradictory persistence/secret-store evidence. */
export class CalendarGoogleOAuthAuthorizationDependencyError extends Error {
  /** Creates a fixed dependency failure without retaining verifier or provider material. */
  constructor() {
    super('Google Calendar OAuth authorization is unavailable');
    this.name = 'CalendarGoogleOAuthAuthorizationDependencyError';
  }
}

interface CalendarGoogleOAuthAuthorizationDependencies {
  readonly now?: () => string;
  readonly createStateId?: () => string;
  readonly createVerifier?: () => string;
}

function invalid(): never {
  throw new CalendarGoogleOAuthAuthorizationValidationError();
}

function unavailable(): never {
  throw new CalendarGoogleOAuthAuthorizationDependencyError();
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

function requireDependencyUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return unavailable();
  }
  return value.toLowerCase();
}

function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return unavailable();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return unavailable();
  }
  return value;
}

function requireVerifier(value: unknown): string {
  if (typeof value !== 'string' || !PKCE_VERIFIER_PATTERN.test(value)) {
    return unavailable();
  }
  return value;
}

function challengeFor(verifier: string): string {
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  if (!PKCE_CHALLENGE_PATTERN.test(challenge)) {
    return unavailable();
  }
  return challenge;
}

function defaultVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function requireConfiguredRedirectUri(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    return unavailable();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return unavailable();
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.origin === 'null' ||
    parsed.toString() !== value
  ) {
    return unavailable();
  }
  return value;
}

function requireExactRedirectUri(value: unknown, configured: string): string {
  if (typeof value !== 'string' || value !== configured) {
    return invalid();
  }
  return configured;
}

function requireCurrentInstant(now: () => string): {
  readonly value: string;
  readonly milliseconds: number;
} {
  const value = requireInstant(now());
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    return unavailable();
  }
  return { value, milliseconds };
}

function recordsMatch(
  actual: CalendarGoogleOAuthAuthorizationStateRecord,
  expected: CalendarGoogleOAuthAuthorizationStateRecord,
): boolean {
  return (
    actual.stateId === expected.stateId &&
    actual.workspaceId === expected.workspaceId &&
    actual.userId === expected.userId &&
    actual.purpose === expected.purpose &&
    actual.redirectUri === expected.redirectUri &&
    actual.verifierSecretReference === expected.verifierSecretReference &&
    actual.codeChallenge === expected.codeChallenge &&
    actual.createdAt === expected.createdAt &&
    actual.expiresAt === expected.expiresAt &&
    actual.consumedAt === expected.consumedAt
  );
}

/**
 * Owns initiation and single-consumption rules for Google Calendar OAuth state.
 *
 * The application accepts workspace/user authority only from the trusted
 * server-derived Calendar context. The callback redirect is an exact
 * operator-configured HTTPS URI. PKCE verifier material is written through a
 * secret-store port before the durable state record is created; only its
 * opaque UUIDv4 reference is persisted. State consumption is delegated to an
 * atomic repository operation, then the verifier is materialized for the
 * internal token-exchange boundary. Provider token exchange and post-exchange
 * verifier cleanup are deliberately separate follow-up responsibilities.
 */
export class CalendarGoogleOAuthAuthorizationApplication {
  private readonly redirectUri: string;
  private readonly now: () => string;
  private readonly createStateId: () => string;
  private readonly createVerifier: () => string;

  /** Creates the application over Calendar-owned state and secret boundaries. */
  constructor(
    private readonly states: CalendarGoogleOAuthAuthorizationStateRepository,
    private readonly verifiers: CalendarGoogleOAuthVerifierSecretStore,
    configuredRedirectUri: string,
    dependencies: CalendarGoogleOAuthAuthorizationDependencies = {},
  ) {
    this.redirectUri = requireConfiguredRedirectUri(configuredRedirectUri);
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createStateId = dependencies.createStateId ?? randomUUID;
    this.createVerifier = dependencies.createVerifier ?? defaultVerifier;
  }

  /**
   * Begins one five-minute Google authorization ceremony and returns only
   * credential-free browser parameters. Durable state remains scoped to the
   * exact trusted workspace, user, purpose, and configured callback URI.
   */
  async issue(
    authority: TrustedCalendarUserContext,
    input: { readonly redirectUri: unknown },
  ): Promise<CalendarGoogleOAuthAuthorizationIssueResult> {
    const workspaceId = requireUuid(authority?.workspaceId);
    const userId = requireUuid(authority?.userId);
    const redirectUri = requireExactRedirectUri(input?.redirectUri, this.redirectUri);
    const stateId = requireUuid(this.createStateId());
    const verifier = requireVerifier(this.createVerifier());
    const codeChallenge = challengeFor(verifier);
    const created = requireCurrentInstant(this.now);
    const expiresAt = new Date(
      created.milliseconds + AUTHORIZATION_STATE_LIFETIME_MILLISECONDS,
    ).toISOString();

    let rawVerifierSecretReference: string | undefined;
    let verifierSecretReference: string;
    try {
      rawVerifierSecretReference = await this.verifiers.writeVerifier({
        stateId,
        workspaceId,
        userId,
        verifier,
      });
      verifierSecretReference = requireDependencyUuid(rawVerifierSecretReference);
    } catch {
      if (typeof rawVerifierSecretReference === 'string') {
        try {
          await this.verifiers.deleteVerifier(rawVerifierSecretReference);
        } catch {
          // Fail closed even if the secret backend cannot compensate. The
          // backend must independently expire/reconcile incomplete ceremonies.
        }
      }
      return unavailable();
    }

    const record: CalendarGoogleOAuthAuthorizationStateRecord = Object.freeze({
      stateId,
      workspaceId,
      userId,
      purpose: PURPOSE,
      redirectUri,
      verifierSecretReference,
      codeChallenge,
      createdAt: created.value,
      expiresAt,
      consumedAt: null,
    });

    try {
      const persisted = await this.states.createAuthorizationState(record);
      if (!persisted || !recordsMatch(persisted, record)) {
        throw new CalendarGoogleOAuthAuthorizationDependencyError();
      }
    } catch {
      try {
        await this.verifiers.deleteVerifier(verifierSecretReference);
      } catch {
        // The public result still fails closed. Operators need independent
        // secret-store expiry/reconciliation for cleanup after a failed saga.
      }
      return unavailable();
    }

    return Object.freeze({
      state: stateId,
      codeChallenge,
      codeChallengeMethod: 'S256' as const,
      expiresAt,
    });
  }

  /**
   * Atomically consumes one exact-scope state and materializes its PKCE
   * verifier for the private token-exchange boundary. Replays, expiry, and
   * workspace/user/redirect substitution are indistinguishable validation
   * failures and never cause secret materialization.
   */
  async consume(
    authority: TrustedCalendarUserContext,
    input: { readonly state: unknown; readonly redirectUri: unknown },
  ): Promise<CalendarGoogleOAuthAuthorizationConsumeResult> {
    const workspaceId = requireUuid(authority?.workspaceId);
    const userId = requireUuid(authority?.userId);
    const stateId = requireUuid(input?.state);
    const redirectUri = requireExactRedirectUri(input?.redirectUri, this.redirectUri);
    const consumed = requireCurrentInstant(this.now);

    let record: CalendarGoogleOAuthAuthorizationStateRecord | null;
    try {
      record = await this.states.consumeAuthorizationState({
        stateId,
        workspaceId,
        userId,
        redirectUri,
        consumedAt: consumed.value,
      });
    } catch {
      return unavailable();
    }
    if (record === null) {
      return invalid();
    }

    const expected: CalendarGoogleOAuthAuthorizationStateRecord = Object.freeze({
      stateId,
      workspaceId,
      userId,
      purpose: PURPOSE,
      redirectUri,
      verifierSecretReference: requireDependencyUuid(record.verifierSecretReference),
      codeChallenge:
        typeof record.codeChallenge === 'string' &&
        PKCE_CHALLENGE_PATTERN.test(record.codeChallenge)
          ? record.codeChallenge
          : unavailable(),
      createdAt: requireInstant(record.createdAt),
      expiresAt: requireInstant(record.expiresAt),
      consumedAt: consumed.value,
    });
    if (
      !recordsMatch(record, expected) ||
      Date.parse(expected.createdAt) >= Date.parse(expected.expiresAt) ||
      Date.parse(expected.expiresAt) <= consumed.milliseconds
    ) {
      return unavailable();
    }

    let verifier: string;
    try {
      verifier = requireVerifier(
        await this.verifiers.readVerifier(expected.verifierSecretReference),
      );
    } catch (error) {
      if (error instanceof CalendarGoogleOAuthAuthorizationDependencyError) {
        throw error;
      }
      return unavailable();
    }
    if (challengeFor(verifier) !== expected.codeChallenge) {
      return unavailable();
    }
    return Object.freeze({ codeVerifier: verifier });
  }
}
