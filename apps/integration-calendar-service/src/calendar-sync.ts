const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRONG_ETAG_PATTERN = /^"[^"\r\n]{1,200}"$/;
const MAXIMUM_TITLE_LENGTH = 500;
const MAXIMUM_TIME_BLOCK_DURATION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const MAXIMUM_VERSION = 2_147_483_647;
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const ICALENDAR_LINE_LIMIT_OCTETS = 75;

/** Untrusted HTTP request body for one conflict-safe calendar synchronization. */
export interface CalendarSyncInput {
  readonly blockId: unknown;
  readonly title: unknown;
  readonly startsAt: unknown;
  readonly endsAt: unknown;
  readonly timeZone: unknown;
  readonly version: unknown;
  readonly providerEtag?: unknown;
}

/** Validated LifeOS time block rendered as one external calendar event. */
export interface CalendarTimeBlock {
  readonly blockId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly version: number;
  readonly providerEtag?: string;
}

export type CalendarWritePrecondition =
  | { readonly kind: 'create' }
  | { readonly kind: 'update'; readonly etag: string };

/** Complete provider operation. No destructive operation exists in this contract. */
export interface CalendarProviderWrite {
  readonly resourceName: string;
  readonly calendarData: string;
  readonly precondition: CalendarWritePrecondition;
}

/** Successful external write receipt used for optimistic concurrency. */
export interface CalendarProviderReceipt {
  readonly status: 'created' | 'updated';
  readonly etag: string;
}

/** Provider boundary intentionally exposes only conflict-safe upsert behavior. */
export interface CalendarProvider {
  put(write: CalendarProviderWrite): Promise<CalendarProviderReceipt>;
}

/** API result containing the strong provider ETag required for later updates. */
export interface CalendarSyncResult extends CalendarProviderReceipt {
  readonly blockId: string;
  readonly workspaceId: string;
  readonly resourceName: string;
}

export type CalendarClock = () => Date;
export type CalendarFetch = typeof fetch;

/** Stable validation failure suitable for bounded HTTP error mapping. */
export class CalendarValidationError extends Error {
  constructor() {
    super('Calendar synchronization input is invalid');
    this.name = 'CalendarValidationError';
  }
}

/** Optimistic-concurrency failure that prevents duplicate or destructive writes. */
export class CalendarConflictError extends Error {
  constructor() {
    super('Calendar resource changed or already exists');
    this.name = 'CalendarConflictError';
  }
}

/** Credential-free provider failure suitable for a dependency response. */
export class CalendarDependencyError extends Error {
  constructor() {
    super('Calendar provider is unavailable');
    this.name = 'CalendarDependencyError';
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

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): void {
  const expectedKeys = new Set(expected);
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== expectedKeys.size ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    invalid();
  }
}

function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /\u0000/.test(value)) {
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
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    return invalid();
  }
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) {
    return invalid();
  }
  return parsed.toISOString();
}

function requireTimeZone(value: unknown): string {
  const normalized = requireString(value, 100);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format();
  } catch {
    return invalid();
  }
  return normalized;
}

function requireVersion(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAXIMUM_VERSION
  ) {
    return invalid();
  }
  return value;
}

function requireStrongEtag(value: unknown): string {
  const normalized = requireString(value, 202);
  if (!STRONG_ETAG_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

/** Validates and snapshots an untrusted time-block request. */
export function validateCalendarTimeBlock(value: unknown): CalendarTimeBlock {
  const record = requireRecord(value);
  const hasProviderEtag = Object.hasOwn(record, 'providerEtag');
  requireExactKeys(
    record,
    hasProviderEtag
      ? [
          'blockId',
          'title',
          'startsAt',
          'endsAt',
          'timeZone',
          'version',
          'providerEtag',
        ]
      : ['blockId', 'title', 'startsAt', 'endsAt', 'timeZone', 'version'],
  );

  const startsAt = requireInstant(record.startsAt);
  const endsAt = requireInstant(record.endsAt);
  const duration = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  if (
    duration <= 0 ||
    duration > MAXIMUM_TIME_BLOCK_DURATION_MILLISECONDS
  ) {
    return invalid();
  }

  const base = {
    blockId: requireUuidV4(record.blockId),
    title: requireString(record.title, MAXIMUM_TITLE_LENGTH),
    startsAt,
    endsAt,
    timeZone: requireTimeZone(record.timeZone),
    version: requireVersion(record.version),
  };
  return Object.freeze(
    hasProviderEtag
      ? { ...base, providerEtag: requireStrongEtag(record.providerEtag) }
      : base,
  );
}

function formatUtcTimestamp(value: string): string {
  return value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcalendarText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcalendarLine(line: string): string {
  const segments: string[] = [];
  let segment = '';
  let octets = 0;

  for (const character of line) {
    const characterOctets = Buffer.byteLength(character, 'utf8');
    if (octets + characterOctets > ICALENDAR_LINE_LIMIT_OCTETS) {
      segments.push(segment);
      segment = ` ${character}`;
      octets = 1 + characterOctets;
    } else {
      segment += character;
      octets += characterOctets;
    }
  }
  segments.push(segment);
  return segments.join('\r\n');
}

/** Renders a standards-based VEVENT with a deterministic LifeOS identity. */
export function renderIcalendarEvent(
  workspaceId: string,
  block: CalendarTimeBlock,
  timestamp: Date,
): string {
  if (!Number.isFinite(timestamp.getTime())) {
    return invalid();
  }
  const uid = `${workspaceId}.${block.blockId}@life-os`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Contextual Wisdom Lab//LifeOS Calendar Sync 1.0//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtcTimestamp(timestamp.toISOString())}`,
    `DTSTART:${formatUtcTimestamp(block.startsAt)}`,
    `DTEND:${formatUtcTimestamp(block.endsAt)}`,
    `SEQUENCE:${block.version}`,
    `SUMMARY:${escapeIcalendarText(block.title)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    `X-LIFE-OS-WORKSPACE-ID:${workspaceId}`,
    `X-LIFE-OS-BLOCK-ID:${block.blockId}`,
    `X-LIFE-OS-TIME-ZONE:${escapeIcalendarText(block.timeZone)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcalendarLine).join('\r\n')}\r\n`;
}

/** Synchronizes one event and never receives delete, move, or copy capability. */
export class CalendarSyncService {
  constructor(
    private readonly provider: CalendarProvider,
    private readonly clock: CalendarClock = () => new Date(),
  ) {}

  async sync(workspaceIdValue: string, input: unknown): Promise<CalendarSyncResult> {
    const workspaceId = requireUuidV4(workspaceIdValue);
    const block = validateCalendarTimeBlock(input);
    const resourceName = `life-os-${workspaceId}-${block.blockId}.ics`;
    const precondition: CalendarWritePrecondition = block.providerEtag
      ? { kind: 'update', etag: block.providerEtag }
      : { kind: 'create' };
    const receipt = await this.provider.put(
      Object.freeze({
        resourceName,
        calendarData: renderIcalendarEvent(workspaceId, block, this.clock()),
        precondition,
      }),
    );
    return Object.freeze({
      blockId: block.blockId,
      workspaceId,
      resourceName,
      status: receipt.status,
      etag: requireStrongEtag(receipt.etag),
    });
  }
}

export interface CaldavCalendarProviderConfiguration {
  readonly calendarUrl: string;
  readonly authorization: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMilliseconds?: number;
  readonly fetchImplementation?: CalendarFetch;
}

function requireAuthorization(value: string): string {
  if (!value || value.length > 4_096 || /[\r\n]/.test(value)) {
    throw new Error('Invalid CalDAV authorization configuration');
  }
  return value;
}

function requireCaldavBaseUrl(
  value: string,
  allowedHosts: readonly string[],
): URL {
  const allowed = new Set(allowedHosts.map((host) => host.trim().toLowerCase()));
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid CalDAV URL configuration');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !allowed.size ||
    !allowed.has(parsed.hostname.toLowerCase())
  ) {
    throw new Error('Invalid CalDAV URL configuration');
  }
  if (!parsed.pathname.endsWith('/')) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

/** CalDAV adapter using RFC conditional requests to prevent silent overwrites. */
export class CaldavCalendarProvider implements CalendarProvider {
  private readonly baseUrl: URL;
  private readonly authorization: string;
  private readonly timeoutMilliseconds: number;
  private readonly fetchImplementation: CalendarFetch;

  constructor(configuration: CaldavCalendarProviderConfiguration) {
    this.baseUrl = requireCaldavBaseUrl(
      configuration.calendarUrl,
      configuration.allowedHosts,
    );
    this.authorization = requireAuthorization(configuration.authorization);
    this.timeoutMilliseconds =
      configuration.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (
      !Number.isInteger(this.timeoutMilliseconds) ||
      this.timeoutMilliseconds < 100 ||
      this.timeoutMilliseconds > 30_000
    ) {
      throw new Error('Invalid CalDAV timeout configuration');
    }
    this.fetchImplementation = configuration.fetchImplementation ?? fetch;
  }

  async put(write: CalendarProviderWrite): Promise<CalendarProviderReceipt> {
    if (!/^life-os-[0-9a-f-]+\.ics$/.test(write.resourceName)) {
      throw new CalendarValidationError();
    }
    const resourceUrl = new URL(write.resourceName, this.baseUrl);
    const headers: Record<string, string> = {
      accept: 'text/calendar',
      authorization: this.authorization,
      'content-type': 'text/calendar; charset=utf-8',
    };
    if (write.precondition.kind === 'create') {
      headers['if-none-match'] = '*';
    } else {
      headers['if-match'] = requireStrongEtag(write.precondition.etag);
    }

    const response = await this.request(resourceUrl, {
      method: 'PUT',
      headers,
      body: write.calendarData,
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.status === 409 || response.status === 412) {
      await response.body?.cancel();
      throw new CalendarConflictError();
    }
    if (response.status !== 200 && response.status !== 201 && response.status !== 204) {
      await response.body?.cancel();
      throw new CalendarDependencyError();
    }
    await response.body?.cancel();
    const responseEtag = response.headers.get('etag');
    const etag = responseEtag
      ? requireStrongEtag(responseEtag)
      : await this.fetchStrongEtag(resourceUrl);
    return Object.freeze({
      status: write.precondition.kind === 'create' ? 'created' : 'updated',
      etag,
    });
  }

  private async fetchStrongEtag(resourceUrl: URL): Promise<string> {
    const response = await this.request(resourceUrl, {
      method: 'GET',
      headers: {
        accept: 'text/calendar',
        authorization: this.authorization,
      },
      redirect: 'error',
      cache: 'no-store',
    });
    await response.body?.cancel();
    if (response.status !== 200) {
      throw new CalendarDependencyError();
    }
    const etag = response.headers.get('etag');
    if (!etag) {
      throw new CalendarDependencyError();
    }
    return requireStrongEtag(etag);
  }

  private async request(resourceUrl: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    try {
      return await this.fetchImplementation(resourceUrl, {
        ...init,
        signal: controller.signal,
      });
    } catch {
      throw new CalendarDependencyError();
    } finally {
      clearTimeout(timer);
    }
  }
}
