import { createHash } from 'node:crypto';
import {
  CalendarConflictError,
  CalendarDependencyError,
  type CalendarFetch,
  type CalendarProvider,
  type CalendarProviderReceipt,
  type CalendarProviderWrite,
  CalendarValidationError,
} from './calendar-sync';

const GOOGLE_CALENDAR_API_BASE_URL =
  'https://www.googleapis.com/calendar/v3/';
const DEFAULT_TIMEOUT_MILLISECONDS = 5_000;
const MAXIMUM_RESPONSE_BYTES = 64 * 1_024;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRONG_ETAG_PATTERN = /^"[^"\r\n]{1,200}"$/;
const GOOGLE_EVENT_ID_PATTERN = /^[0-9a-v]{5,1024}$/;

interface GoogleCalendarEvent {
  readonly id?: string;
  readonly summary: string;
  readonly start: {
    readonly dateTime: string;
    readonly timeZone: string;
  };
  readonly end: {
    readonly dateTime: string;
    readonly timeZone: string;
  };
  readonly sequence: number;
  readonly status: 'confirmed';
  readonly transparency: 'opaque';
  readonly extendedProperties: {
    readonly private: {
      readonly lifeOsWorkspaceId: string;
      readonly lifeOsBlockId: string;
      readonly lifeOsVersion: string;
    };
  };
}

interface ParsedCalendarEvent {
  readonly workspaceId: string;
  readonly blockId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: string;
  readonly version: number;
}

/** Secret-backed configuration for the fixed Google Calendar API adapter. */
export interface GoogleCalendarProviderConfiguration {
  readonly calendarId: string;
  readonly accessToken: string;
  readonly timeoutMilliseconds?: number;
  readonly fetchImplementation?: CalendarFetch;
}

function invalid(): never {
  throw new CalendarValidationError();
}

function requireBoundedString(
  value: unknown,
  maximumLength: number,
): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000\r\n]/.test(value)
  ) {
    return invalid();
  }
  return normalized;
}

function requireUuidV4(value: string): string {
  const normalized = requireBoundedString(value, 64).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireStrongEtag(value: unknown): string {
  const normalized = requireBoundedString(value, 202);
  if (!STRONG_ETAG_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireCalendarId(value: string): string {
  const normalized = requireBoundedString(value, 1_024);
  if (/[/\\?#]/.test(normalized)) {
    throw new Error('Invalid Google Calendar identifier configuration');
  }
  return normalized;
}

function requireAccessToken(value: string): string {
  const normalized = requireBoundedString(value, 4_096);
  if (/\s/.test(normalized)) {
    throw new Error('Invalid Google Calendar access-token configuration');
  }
  return normalized;
}

function parseUtcTimestamp(value: string): string {
  const match =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) {
    return invalid();
  }
  const timestamp = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  );
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString().replace(/[-:]/g, '').replace('.000', '') !== value
  ) {
    return invalid();
  }
  return timestamp.toISOString();
}

function unescapeIcalendarText(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      output += character;
      continue;
    }
    const escaped = value[index + 1];
    if (!escaped) {
      return invalid();
    }
    if (escaped === 'n' || escaped === 'N') {
      output += '\n';
    } else if (escaped === '\\' || escaped === ';' || escaped === ',') {
      output += escaped;
    } else {
      return invalid();
    }
    index += 1;
  }
  return output;
}

function requireLineValue(line: string, prefix: string): string {
  if (!line.startsWith(prefix)) {
    return invalid();
  }
  return line.slice(prefix.length);
}

function parseCalendarEvent(write: CalendarProviderWrite): ParsedCalendarEvent {
  const unfolded = write.calendarData.replace(/\r\n[ \t]/g, '');
  const lines = unfolded.endsWith('\r\n')
    ? unfolded.slice(0, -2).split('\r\n')
    : invalid();
  if (lines.length !== 18) {
    return invalid();
  }
  if (
    lines[0] !== 'BEGIN:VCALENDAR' ||
    lines[1] !== 'VERSION:2.0' ||
    lines[2] !==
      'PRODID:-//Contextual Wisdom Lab//LifeOS Calendar Sync 1.0//EN' ||
    lines[3] !== 'CALSCALE:GREGORIAN' ||
    lines[4] !== 'BEGIN:VEVENT' ||
    lines[12] !== 'STATUS:CONFIRMED' ||
    lines[13] !== 'TRANSP:OPAQUE' ||
    lines[16] !== 'END:VEVENT' ||
    lines[17] !== 'END:VCALENDAR'
  ) {
    return invalid();
  }

  const workspaceId = requireUuidV4(
    requireLineValue(lines[14] ?? '', 'X-LIFE-OS-WORKSPACE-ID:'),
  );
  const blockId = requireUuidV4(
    requireLineValue(lines[15] ?? '', 'X-LIFE-OS-BLOCK-ID:'),
  );
  const expectedResourceName = `life-os-${workspaceId}-${blockId}.ics`;
  if (write.resourceName !== expectedResourceName) {
    return invalid();
  }
  if (
    requireLineValue(lines[5] ?? '', 'UID:') !==
    `${workspaceId}.${blockId}@life-os`
  ) {
    return invalid();
  }

  parseUtcTimestamp(requireLineValue(lines[6] ?? '', 'DTSTAMP:'));
  const startsAt = parseUtcTimestamp(
    requireLineValue(lines[7] ?? '', 'DTSTART:'),
  );
  const endsAt = parseUtcTimestamp(
    requireLineValue(lines[8] ?? '', 'DTEND:'),
  );
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return invalid();
  }

  const versionText = requireLineValue(lines[9] ?? '', 'SEQUENCE:');
  if (!/^\d{1,10}$/.test(versionText)) {
    return invalid();
  }
  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || version > 2_147_483_647) {
    return invalid();
  }

  const title = unescapeIcalendarText(
    requireLineValue(lines[10] ?? '', 'SUMMARY:'),
  ).trim();
  if (!title || title.length > 500 || /\u0000/.test(title)) {
    return invalid();
  }
  const timeZone = unescapeIcalendarText(
    requireLineValue(lines[11] ?? '', 'X-LIFE-OS-TIME-ZONE:'),
  );
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    return invalid();
  }

  return Object.freeze({
    workspaceId,
    blockId,
    title,
    startsAt,
    endsAt,
    timeZone,
    version,
  });
}

/** Creates a stable Google event identifier from one LifeOS calendar resource. */
export function createGoogleCalendarEventId(resourceName: string): string {
  if (!/^life-os-[0-9a-f-]+\.ics$/.test(resourceName)) {
    return invalid();
  }
  const eventId = `lifeos${createHash('sha256')
    .update(resourceName, 'utf8')
    .digest('hex')}`;
  if (!GOOGLE_EVENT_ID_PATTERN.test(eventId)) {
    return invalid();
  }
  return eventId;
}

function createEventBody(
  parsed: ParsedCalendarEvent,
  eventId: string,
  includeId: boolean,
): GoogleCalendarEvent {
  const event = {
    summary: parsed.title,
    start: {
      dateTime: parsed.startsAt,
      timeZone: parsed.timeZone,
    },
    end: {
      dateTime: parsed.endsAt,
      timeZone: parsed.timeZone,
    },
    sequence: parsed.version,
    status: 'confirmed' as const,
    transparency: 'opaque' as const,
    extendedProperties: {
      private: {
        lifeOsWorkspaceId: parsed.workspaceId,
        lifeOsBlockId: parsed.blockId,
        lifeOsVersion: String(parsed.version),
      },
    },
  };
  return Object.freeze(includeId ? { id: eventId, ...event } : event);
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Provider diagnostics are intentionally discarded.
  }
}

async function readBoundedJson(
  response: Response,
): Promise<Readonly<Record<string, unknown>>> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_RESPONSE_BYTES)
  ) {
    await discardResponseBody(response);
    throw new CalendarDependencyError();
  }
  if (!response.body) {
    throw new CalendarDependencyError();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CalendarDependencyError();
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof CalendarDependencyError) {
      throw error;
    }
    throw new CalendarDependencyError();
  } finally {
    reader.releaseLock();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
    );
  } catch {
    throw new CalendarDependencyError();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CalendarDependencyError();
  }
  return parsed as Readonly<Record<string, unknown>>;
}

/** Google Calendar adapter with deterministic create identity and ETag updates. */
export class GoogleCalendarProvider implements CalendarProvider {
  private readonly calendarId: string;
  private readonly accessToken: string;
  private readonly timeoutMilliseconds: number;
  private readonly fetchImplementation: CalendarFetch;

  constructor(configuration: GoogleCalendarProviderConfiguration) {
    this.calendarId = requireCalendarId(configuration.calendarId);
    this.accessToken = requireAccessToken(configuration.accessToken);
    this.timeoutMilliseconds =
      configuration.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (
      !Number.isInteger(this.timeoutMilliseconds) ||
      this.timeoutMilliseconds < 100 ||
      this.timeoutMilliseconds > 30_000
    ) {
      throw new Error('Invalid Google Calendar timeout configuration');
    }
    this.fetchImplementation = configuration.fetchImplementation ?? fetch;
  }

  async put(write: CalendarProviderWrite): Promise<CalendarProviderReceipt> {
    const parsed = parseCalendarEvent(write);
    const eventId = createGoogleCalendarEventId(write.resourceName);
    const encodedCalendarId = encodeURIComponent(this.calendarId);
    const createOperation = write.precondition.kind === 'create';
    const path = createOperation
      ? `calendars/${encodedCalendarId}/events?sendUpdates=none`
      : `calendars/${encodedCalendarId}/events/${eventId}?sendUpdates=none`;
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.accessToken}`,
      'content-type': 'application/json; charset=utf-8',
    };
    if (!createOperation) {
      headers['if-match'] = requireStrongEtag(write.precondition.etag);
    }

    const response = await this.request(new URL(path, GOOGLE_CALENDAR_API_BASE_URL), {
      method: createOperation ? 'POST' : 'PUT',
      headers,
      body: JSON.stringify(createEventBody(parsed, eventId, createOperation)),
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.status === 409 || response.status === 412) {
      await discardResponseBody(response);
      throw new CalendarConflictError();
    }
    if (response.status !== 200 && response.status !== 201) {
      await discardResponseBody(response);
      throw new CalendarDependencyError();
    }

    const receipt = await readBoundedJson(response);
    if (receipt.id !== eventId) {
      throw new CalendarDependencyError();
    }
    let etag: string;
    try {
      etag = requireStrongEtag(receipt.etag);
    } catch {
      throw new CalendarDependencyError();
    }
    return Object.freeze({
      status: createOperation ? 'created' : 'updated',
      etag,
    });
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
    try {
      return await this.fetchImplementation(url, {
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
