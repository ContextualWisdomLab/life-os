import { createHmac, randomUUID } from 'node:crypto';
import {
  evaluatePrivacyAccessRequest,
  type PrivacyAccessAction,
  type PrivacyAccessDecision,
  type PrivacyAccessPurpose,
  type PrivacyResourceCategory,
} from './privacy-access-domain';
import type {
  PrivacyAccessRepository,
  PrivacyGrantConsumptionReceipt,
} from './privacy-access-repository';
import {
  createPrivacyAccessGrantToken,
  verifyPrivacyAccessGrantToken,
  type PrivacyGrantKeyRing,
} from './privacy-access-token';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MINIMUM_DIGEST_KEY_BYTES = 32;
const MAXIMUM_DIGEST_KEY_BYTES = 4_096;
const MAXIMUM_REFERENCE_CHARACTERS = 256;
const MAXIMUM_REFERENCE_BYTES = 1_024;
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000a-\u001f\u007f]/u;

/** Command accepted by the application after trusted ownership is attached. */
export interface PrivacyAccessDecisionCommand {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: PrivacyAccessPurpose;
  readonly action: PrivacyAccessAction;
  readonly resourceCategory: PrivacyResourceCategory;
  readonly requestedTtlSeconds: number;
  readonly reason?: string;
}

/** Persisted decision plus an opaque grant token only for allowed outcomes. */
export interface PrivacyAccessDecisionResult {
  readonly decision: PrivacyAccessDecision;
  readonly grantToken?: string;
}

/** Command that consumes one exact grant before a service-local personal-data read. */
export interface PrivacyAccessConsumeCommand {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly grantToken: string;
  readonly resourceReference?: string;
}

/** Deterministic dependencies and protected key material for the application. */
export interface PrivacyAccessApplicationDependencies {
  readonly repository: PrivacyAccessRepository;
  readonly grantKeyRing: PrivacyGrantKeyRing;
  readonly auditDigestKey: string;
  readonly uuidFactory?: () => string;
  readonly clock?: () => Date;
}

/** Service-local reader that receives verified metadata but owns the original PII store. */
export interface AuthorizedPersonalDataReader<T> {
  /** Returns the original authorized payload through the domain service's own query. */
  read(receipt: PrivacyGrantConsumptionReceipt): Promise<T>;
}

/** Stable application failure that never retains token, reason, PII, or dependency details. */
export class PrivacyAccessApplicationError extends Error {
  /** Creates one credential-free bounded application failure. */
  constructor() {
    super('Privacy access operation failed');
    this.name = 'PrivacyAccessApplicationError';
  }
}

function invalid(): never {
  throw new PrivacyAccessApplicationError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : invalid();
}

function requireDigestKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    DISALLOWED_CONTROL_PATTERN.test(value)
  ) {
    return invalid();
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes >= MINIMUM_DIGEST_KEY_BYTES && bytes <= MAXIMUM_DIGEST_KEY_BYTES
    ? value
    : invalid();
}

function requireNow(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return invalid();
  }
  return new Date(value.getTime());
}

function normalizeReference(value: unknown): string {
  if (value === undefined) {
    return 'unspecified';
  }
  if (typeof value !== 'string' || DISALLOWED_CONTROL_PATTERN.test(value)) {
    return invalid();
  }
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (
    normalized === '' ||
    [...normalized].length > MAXIMUM_REFERENCE_CHARACTERS ||
    Buffer.byteLength(normalized, 'utf8') > MAXIMUM_REFERENCE_BYTES
  ) {
    return invalid();
  }
  return normalized;
}

function keyedDigest(key: string, label: string, value: string): string {
  return createHmac('sha256', key)
    .update(`${label}\u0000${value}`, 'utf8')
    .digest('hex');
}

/** Coordinates policy evaluation, grant signing, persistence, and one-time use. */
export class PrivacyAccessApplication {
  private readonly repository: PrivacyAccessRepository;
  private readonly grantKeyRing: PrivacyGrantKeyRing;
  private readonly auditDigestKey: string;
  private readonly uuidFactory: () => string;
  private readonly clock: () => Date;

  /** Creates one application with explicit persistence, cryptography, and clocks. */
  constructor(dependencies: PrivacyAccessApplicationDependencies) {
    if (!dependencies || typeof dependencies !== 'object') {
      invalid();
    }
    this.repository = dependencies.repository;
    this.grantKeyRing = dependencies.grantKeyRing;
    this.auditDigestKey = requireDigestKey(dependencies.auditDigestKey);
    this.uuidFactory = dependencies.uuidFactory ?? randomUUID;
    this.clock = dependencies.clock ?? (() => new Date());
  }

  /** Evaluates and persists one purpose-bound decision before returning evidence. */
  async decide(
    command: PrivacyAccessDecisionCommand,
  ): Promise<PrivacyAccessDecisionResult> {
    try {
      const decision = evaluatePrivacyAccessRequest(
        {
          ...command,
          requestedAt: requireNow(this.clock()),
        },
        {
          uuidFactory: this.uuidFactory,
          auditDigestKey: this.auditDigestKey,
        },
      );
      if (decision.outcome === 'denied') {
        await this.repository.persistDecision({ decision });
        return Object.freeze({ decision });
      }
      const grantToken = createPrivacyAccessGrantToken(
        decision,
        this.grantKeyRing,
      );
      await this.repository.persistDecision({
        decision,
        tokenDigest: keyedDigest(
          this.auditDigestKey,
          'grant-token',
          grantToken,
        ),
      });
      return Object.freeze({ decision, grantToken });
    } catch {
      return invalid();
    }
  }

  /** Verifies and atomically consumes one exact single-use grant. */
  async consume(
    command: PrivacyAccessConsumeCommand,
  ): Promise<PrivacyGrantConsumptionReceipt> {
    try {
      const now = requireNow(this.clock());
      const workspaceId = requireUuidV4(command.workspaceId);
      const actorId = requireUuidV4(command.actorId);
      const claims = verifyPrivacyAccessGrantToken(
        command.grantToken,
        this.grantKeyRing,
        { workspaceId, actorId, now },
      );
      const accessEventId = requireUuidV4(this.uuidFactory());
      const reference = normalizeReference(command.resourceReference);
      return await this.repository.consumeGrant({
        claims,
        tokenDigest: keyedDigest(
          this.auditDigestKey,
          'grant-token',
          command.grantToken,
        ),
        accessEventId,
        resourceReferenceDigest: keyedDigest(
          this.auditDigestKey,
          'resource-reference',
          reference,
        ),
        occurredAt: now.toISOString(),
      });
    } catch {
      return invalid();
    }
  }
}

/**
 * Consumes authorization before invoking a service-local reader and returns the
 * exact original payload without masking, cloning, logging, or transformation.
 */
export async function readOriginalPersonalData<T>(
  application: PrivacyAccessApplication,
  command: PrivacyAccessConsumeCommand,
  reader: AuthorizedPersonalDataReader<T>,
): Promise<T> {
  const receipt = await application.consume(command);
  return await reader.read(receipt);
}
