import { createHash } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const GOOGLE_EVENT_ID_PATTERN = /^[0-9a-v]{5,1024}$/;
const MAXIMUM_TITLE_LENGTH = 300;
const MAXIMUM_DESCRIPTION_LENGTH = 4_000;
const MAXIMUM_ETAG_LENGTH = 256;
const MAXIMUM_SYNC_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/** A bounded request to synchronize one LifeOS time block. */
export interface CalendarSyncRequest {
  readonly sourceId: string;
  readonly title: string;
  readonly description?: string;
  readonly startAt: string;
  readonly endAt: string;
}

/** The exact Google Calendar event representation managed by LifeOS. */
export interface GoogleCalendarEventInput {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly title: string;
  readonly description?: string;
  readonly startAt: string;
  readonly endAt: string;
}

/** Bounded provider acknowledgement for an idempotent upsert. */
export interface GoogleCalendarUpsertResult {
  readonly eventId: string;
  readonly disposition: 'created' | 'unchanged' | 'updated';
  readonly etag: string;
  readonly updatedAt: string;
}

/** Provider boundary. Implementations may mutate only their calendar resource. */
export interface GoogleCalendarGateway {
  upsertEvent(
    input: GoogleCalendarEventInput,
  ): Promise<GoogleCalendarUpsertResult>;
}

/** User-facing synchronization result with explicit provider disposition. */
export interface CalendarSyncResult {
  readonly provider: 'google';
  readonly workspaceId: string;
  readonly sourceId: string;
  readonly providerEventId: string;
  readonly disposition: 'created' | 'unchanged' | 'updated';
  readonly etag: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly synchronizedAt: string;
}

/** Stable validation failure suitable for bounded HTTP mapping. */
export class CalendarValidationError extends Error {
  constructor() {
    super('Calendar synchronization input is invalid');
    this.name = 'CalendarValidationError';
  }
}

/** Credential-free provider failure suitable for bounded HTTP mapping. */
export class CalendarProviderError extends Error {
  constructor() {
    super('Calendar provider operation failed');
    this.name = 'CalendarProviderError';
  }
}

function invalid(): never {
  throw new CalendarValidationError();
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireAllowedKeys(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    invalid();
  }
}

function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    return invalid();
  }
  return normalized;
}

function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireInstant(value: unknown): string {
  const normalized = requireString(value, 64);
  if (!RFC3339_PATTERN.test(normalized)) {
    return invalid();
  }
  const instant = new Date(normalized);
  if (Number.isNaN(instant.getTime())) {
    return invalid();
  }
  return instant.toISOString();
}

function requireGoogleEventId(value: unknown): string {
  const normalized = requireString(value, 1_024).toLowerCase();
  if (!GOOGLE_EVENT_ID_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireOptionalDescription(
  record: Readonly<Record<string, unknown>>,
): string | undefined {
  if (!Object.hasOwn(record, 'description')) {
    return undefined;
  }
  return requireString(record.description, MAXIMUM_DESCRIPTION_LENGTH);
}

/** Validates, canonicalizes, and snapshots untrusted HTTP input. */
export function parseCalendarSyncRequest(value: unknown): CalendarSyncRequest {
  const record = requireRecord(value);
  requireAllowedKeys(
    record,
    ['sourceId', 'title', 'startAt', 'endAt'],
    ['description'],
  );
  const sourceId = requireUuidV4(record.sourceId);
  const title = requireString(record.title, MAXIMUM_TITLE_LENGTH);
  const description = requireOptionalDescription(record);
  const startAt = requireInstant(record.startAt);
  const endAt = requireInstant(record.endAt);
  const duration = Date.parse(endAt) - Date.parse(startAt);
  if (duration <= 0 || duration > MAXIMUM_SYNC_WINDOW_MS) {
    return invalid();
  }
  const base = { sourceId, title, startAt, endAt } as const;
  return description === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, description });
}

/** Derives a stable, tenant-scoped Google event identifier without exposing IDs. */
export function createGoogleEventId(
  workspaceId: string,
  sourceId: string,
): string {
  const workspace = requireUuidV4(workspaceId);
  const source = requireUuidV4(sourceId);
  const digest = createHash('sha256')
    .update(workspace)
    .update('\0')
    .update(source)
    .digest('hex');
  return `lifeos${digest.slice(0, 48)}`;
}

function createProviderInput(
  workspaceId: string,
  request: CalendarSyncRequest,
): GoogleCalendarEventInput {
  const base = {
    eventId: createGoogleEventId(workspaceId, request.sourceId),
    workspaceId,
    sourceId: request.sourceId,
    title: request.title,
    startAt: request.startAt,
    endAt: request.endAt,
  } as const;
  return request.description === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, description: request.description });
}

function validateProviderResult(
  value: unknown,
  expectedEventId: string,
): GoogleCalendarUpsertResult {
  const record = requireRecord(value);
  requireAllowedKeys(record, [
    'eventId',
    'disposition',
    'etag',
    'updatedAt',
  ]);
  const eventId = requireGoogleEventId(record.eventId);
  if (eventId !== expectedEventId) {
    throw new CalendarProviderError();
  }
  const disposition = record.disposition;
  if (
    disposition !== 'created' &&
    disposition !== 'unchanged' &&
    disposition !== 'updated'
  ) {
    throw new CalendarProviderError();
  }
  let etag: string;
  let updatedAt: string;
  try {
    etag = requireString(record.etag, MAXIMUM_ETAG_LENGTH);
    updatedAt = requireInstant(record.updatedAt);
  } catch (error) {
    if (error instanceof CalendarValidationError) {
      throw new CalendarProviderError();
    }
    throw error;
  }
  return Object.freeze({ eventId, disposition, etag, updatedAt });
}

function sameEvent(
  left: GoogleCalendarEventInput,
  right: GoogleCalendarEventInput,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.sourceId === right.sourceId &&
    left.title === right.title &&
    left.description === right.description &&
    left.startAt === right.startAt &&
    left.endAt === right.endAt
  );
}

interface StoredGoogleCalendarEvent {
  readonly input: GoogleCalendarEventInput;
  readonly revision: number;
  readonly updatedAt: string;
}

/**
 * Deterministic local provider used until encrypted per-workspace Google OAuth
 * credentials and the bounded external transport are wired.
 */
export class InMemoryGoogleCalendarGateway implements GoogleCalendarGateway {
  private readonly events = new Map<string, StoredGoogleCalendarEvent>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async upsertEvent(
    input: GoogleCalendarEventInput,
  ): Promise<GoogleCalendarUpsertResult> {
    const current = this.events.get(input.eventId);
    if (
      current &&
      (current.input.workspaceId !== input.workspaceId ||
        current.input.sourceId !== input.sourceId)
    ) {
      throw new CalendarProviderError();
    }
    const now = this.clock();
    if (Number.isNaN(now.getTime())) {
      throw new CalendarProviderError();
    }
    if (!current) {
      const stored = Object.freeze({
        input: Object.freeze({ ...input }),
        revision: 1,
        updatedAt: now.toISOString(),
      });
      this.events.set(input.eventId, stored);
      return Object.freeze({
        eventId: input.eventId,
        disposition: 'created',
        etag: '1',
        updatedAt: stored.updatedAt,
      });
    }
    if (sameEvent(current.input, input)) {
      return Object.freeze({
        eventId: input.eventId,
        disposition: 'unchanged',
        etag: String(current.revision),
        updatedAt: current.updatedAt,
      });
    }
    const stored = Object.freeze({
      input: Object.freeze({ ...input }),
      revision: current.revision + 1,
      updatedAt: now.toISOString(),
    });
    this.events.set(input.eventId, stored);
    return Object.freeze({
      eventId: input.eventId,
      disposition: 'updated',
      etag: String(stored.revision),
      updatedAt: stored.updatedAt,
    });
  }

  eventCount(): number {
    return this.events.size;
  }

  snapshotEvents(): readonly GoogleCalendarEventInput[] {
    return Object.freeze(
      [...this.events.values()]
        .map((event) => Object.freeze({ ...event.input }))
        .sort((left, right) => left.eventId.localeCompare(right.eventId)),
    );
  }
}

/** Synchronizes one tenant-scoped time block through an idempotent provider. */
export class CalendarSyncService {
  constructor(private readonly gateway: GoogleCalendarGateway) {}

  async synchronize(
    workspaceId: string,
    request: CalendarSyncRequest,
  ): Promise<CalendarSyncResult> {
    const workspace = requireUuidV4(workspaceId);
    const validatedRequest = parseCalendarSyncRequest(request);
    const providerInput = createProviderInput(workspace, validatedRequest);
    const providerResult = validateProviderResult(
      await this.gateway.upsertEvent(providerInput),
      providerInput.eventId,
    );
    return Object.freeze({
      provider: 'google',
      workspaceId: workspace,
      sourceId: validatedRequest.sourceId,
      providerEventId: providerResult.eventId,
      disposition: providerResult.disposition,
      etag: providerResult.etag,
      startAt: validatedRequest.startAt,
      endAt: validatedRequest.endAt,
      synchronizedAt: providerResult.updatedAt,
    });
  }
}
