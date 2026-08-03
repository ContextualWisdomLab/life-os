import { createHash, randomUUID } from 'node:crypto';

export const REVIEW_RITUAL_KINDS = [
  'daily-planning',
  'daily-shutdown',
  'weekly-review',
] as const;

export type ReviewRitualKind = (typeof REVIEW_RITUAL_KINDS)[number];

export interface ReviewCompletionInput {
  workspaceId: string;
  ritualKind: ReviewRitualKind;
  periodStartDate: string;
  idempotencyKey: string;
  completedStepCount: number;
  totalStepCount: number;
  plannedItemCount: number;
  completedItemCount: number;
  habitCompletionCount: number;
  reflection?: string;
  completedAt: string;
  payloadDigest: string;
}

export interface ReviewCompletionRecord extends ReviewCompletionInput {
  id: string;
  recordedAt: string;
}

export interface ReviewRepository {
  record(completion: ReviewCompletionRecord): Promise<ReviewCompletionRecord>;
  list(workspaceId: string, limit: number): Promise<ReviewCompletionRecord[]>;
}

/** Raised when untrusted review input violates the bounded contract. */
export class ReviewValidationError extends Error {
  constructor(message = 'Review request is invalid') {
    super(message);
    this.name = 'ReviewValidationError';
  }
}

/** Raised when immutable period or idempotency evidence conflicts. */
export class ReviewCompletionConflictError extends Error {
  constructor() {
    super('Review completion conflicts with immutable evidence');
    this.name = 'ReviewCompletionConflictError';
  }
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_REFLECTION_LENGTH = 2_000;
const MAXIMUM_EVIDENCE_COUNT = 10_000;
const MAXIMUM_STEP_COUNT = 64;
const REVIEW_BODY_KEYS = new Set([
  'periodStartDate',
  'idempotencyKey',
  'completedStepCount',
  'totalStepCount',
  'plannedItemCount',
  'completedItemCount',
  'habitCompletionCount',
  'reflection',
  'completedAt',
]);

type Clock = () => string;
type IdentifierFactory = () => string;

function invalid(message: string): never {
  throw new ReviewValidationError(message);
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('Review request body must be an object');
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!REVIEW_BODY_KEYS.has(key)) {
      invalid('Review request contains an unknown field');
    }
  }
}

/** Validates a tenant workspace identifier at the HTTP and repository boundary. */
export function requireReviewWorkspaceId(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid('Workspace identifier must be a UUIDv4');
  }
  const normalized = value.trim().toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid('Workspace identifier must be a UUIDv4');
  }
  return normalized;
}

/** Validates a supported guided-review ritual kind. */
export function requireReviewRitualKind(value: unknown): ReviewRitualKind {
  if (
    value !== 'daily-planning' &&
    value !== 'daily-shutdown' &&
    value !== 'weekly-review'
  ) {
    return invalid('Review ritual kind is unsupported');
  }
  return value;
}

function requireUuidV4(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    return invalid(`${name} must be a UUIDv4`);
  }
  const normalized = value.trim().toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid(`${name} must be a UUIDv4`);
  }
  return normalized;
}

function requireBoundedInteger(
  value: unknown,
  name: string,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    return invalid(`${name} is out of range`);
  }
  return value;
}

function requireLocalDate(value: unknown, ritualKind: ReviewRitualKind): string {
  if (typeof value !== 'string' || !LOCAL_DATE_PATTERN.test(value)) {
    return invalid('periodStartDate must be an ISO local date');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return invalid('periodStartDate must be a real calendar date');
  }
  if (ritualKind === 'weekly-review' && parsed.getUTCDay() !== 1) {
    return invalid('weekly-review periods must start on Monday');
  }
  return value;
}

function requireInstant(value: unknown, name: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return invalid(`${name} is invalid`);
    return value.toISOString();
  }
  if (typeof value !== 'string') {
    return invalid(`${name} must be an ISO UTC instant`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    return invalid(`${name} must be an ISO UTC instant`);
  }
  return value;
}

function optionalReflection(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    return invalid('reflection must be text');
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAXIMUM_REFLECTION_LENGTH) {
    return invalid('reflection length is invalid');
  }
  return normalized;
}

function requireDigest(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid('payloadDigest must be a SHA-256 digest');
  }
  const normalized = value.toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    return invalid('payloadDigest must be a SHA-256 digest');
  }
  return normalized;
}

function calculatePayloadDigest(
  input: Omit<ReviewCompletionInput, 'payloadDigest'>,
): string {
  const canonical = JSON.stringify({
    workspaceId: input.workspaceId,
    ritualKind: input.ritualKind,
    periodStartDate: input.periodStartDate,
    idempotencyKey: input.idempotencyKey,
    completedStepCount: input.completedStepCount,
    totalStepCount: input.totalStepCount,
    plannedItemCount: input.plannedItemCount,
    completedItemCount: input.completedItemCount,
    habitCompletionCount: input.habitCompletionCount,
    reflection: input.reflection ?? null,
    completedAt: input.completedAt,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function validateCounts(
  completedStepCount: number,
  totalStepCount: number,
  completedItemCount: number,
  plannedItemCount: number,
): void {
  if (totalStepCount < 1) {
    invalid('totalStepCount must be positive');
  }
  if (completedStepCount !== totalStepCount) {
    invalid('A completion must include every ritual step');
  }
  if (completedItemCount > plannedItemCount) {
    invalid('completedItemCount cannot exceed plannedItemCount');
  }
}

/** Parses an exact, bounded completion request and computes its canonical digest. */
export function parseReviewCompletionInput(
  workspaceId: string,
  ritualKind: ReviewRitualKind,
  body: unknown,
): ReviewCompletionInput {
  const value = requireObject(body);
  rejectUnknownKeys(value);

  const safeRitualKind = requireReviewRitualKind(ritualKind);
  const completedStepCount = requireBoundedInteger(
    value.completedStepCount,
    'completedStepCount',
    MAXIMUM_STEP_COUNT,
  );
  const totalStepCount = requireBoundedInteger(
    value.totalStepCount,
    'totalStepCount',
    MAXIMUM_STEP_COUNT,
  );
  const plannedItemCount = requireBoundedInteger(
    value.plannedItemCount,
    'plannedItemCount',
    MAXIMUM_EVIDENCE_COUNT,
  );
  const completedItemCount = requireBoundedInteger(
    value.completedItemCount,
    'completedItemCount',
    MAXIMUM_EVIDENCE_COUNT,
  );
  validateCounts(
    completedStepCount,
    totalStepCount,
    completedItemCount,
    plannedItemCount,
  );
  const reflection = optionalReflection(value.reflection);

  const input: Omit<ReviewCompletionInput, 'payloadDigest'> = {
    workspaceId: requireReviewWorkspaceId(workspaceId),
    ritualKind: safeRitualKind,
    periodStartDate: requireLocalDate(value.periodStartDate, safeRitualKind),
    idempotencyKey: requireUuidV4(value.idempotencyKey, 'idempotencyKey'),
    completedStepCount,
    totalStepCount,
    plannedItemCount,
    completedItemCount,
    habitCompletionCount: requireBoundedInteger(
      value.habitCompletionCount,
      'habitCompletionCount',
      MAXIMUM_EVIDENCE_COUNT,
    ),
    ...(reflection === undefined ? {} : { reflection }),
    completedAt: requireInstant(value.completedAt, 'completedAt'),
  };

  return { ...input, payloadDigest: calculatePayloadDigest(input) };
}

/** Validates a record received from or sent to a persistence adapter. */
export function validateReviewCompletionRecord(
  value: ReviewCompletionRecord,
): ReviewCompletionRecord {
  const ritualKind = requireReviewRitualKind(value.ritualKind);
  const completedStepCount = requireBoundedInteger(
    value.completedStepCount,
    'completedStepCount',
    MAXIMUM_STEP_COUNT,
  );
  const totalStepCount = requireBoundedInteger(
    value.totalStepCount,
    'totalStepCount',
    MAXIMUM_STEP_COUNT,
  );
  const plannedItemCount = requireBoundedInteger(
    value.plannedItemCount,
    'plannedItemCount',
    MAXIMUM_EVIDENCE_COUNT,
  );
  const completedItemCount = requireBoundedInteger(
    value.completedItemCount,
    'completedItemCount',
    MAXIMUM_EVIDENCE_COUNT,
  );
  validateCounts(
    completedStepCount,
    totalStepCount,
    completedItemCount,
    plannedItemCount,
  );
  const reflection = optionalReflection(value.reflection);
  const safeInput: Omit<ReviewCompletionInput, 'payloadDigest'> = {
    workspaceId: requireReviewWorkspaceId(value.workspaceId),
    ritualKind,
    periodStartDate: requireLocalDate(value.periodStartDate, ritualKind),
    idempotencyKey: requireUuidV4(value.idempotencyKey, 'idempotencyKey'),
    completedStepCount,
    totalStepCount,
    plannedItemCount,
    completedItemCount,
    habitCompletionCount: requireBoundedInteger(
      value.habitCompletionCount,
      'habitCompletionCount',
      MAXIMUM_EVIDENCE_COUNT,
    ),
    ...(reflection === undefined ? {} : { reflection }),
    completedAt: requireInstant(value.completedAt, 'completedAt'),
  };
  const digest = requireDigest(value.payloadDigest);
  if (digest !== calculatePayloadDigest(safeInput)) {
    invalid('payloadDigest does not match immutable review evidence');
  }
  return {
    ...safeInput,
    payloadDigest: digest,
    id: requireUuidV4(value.id, 'review completion identifier'),
    recordedAt: requireInstant(value.recordedAt, 'recordedAt'),
  };
}

/** Parses a bounded history page size. */
export function requireReviewLimit(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    return invalid('limit must be an integer from 1 to 100');
  }
  return parsed;
}

/** Coordinates immutable ritual completion and tenant-scoped history. */
export class ReviewService {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly idFactory: IdentifierFactory = randomUUID,
    private readonly clock: Clock = () => new Date().toISOString(),
  ) {}

  async complete(
    workspaceId: string,
    ritualKind: ReviewRitualKind,
    body: unknown,
  ): Promise<ReviewCompletionRecord> {
    const input = parseReviewCompletionInput(workspaceId, ritualKind, body);
    return await this.repository.record(
      validateReviewCompletionRecord({
        ...input,
        id: requireUuidV4(this.idFactory(), 'generated identifier'),
        recordedAt: requireInstant(this.clock(), 'recordedAt'),
      }),
    );
  }

  async list(
    workspaceId: string,
    limit: number,
  ): Promise<ReviewCompletionRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      invalid('limit must be an integer from 1 to 100');
    }
    return await this.repository.list(
      requireReviewWorkspaceId(workspaceId),
      limit,
    );
  }
}
