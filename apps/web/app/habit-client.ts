import { createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_REQUEST_BYTES = 8 * 1024;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_TIMEZONE_CHARACTERS = 128;
const MAXIMUM_HABITS = 100;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const UPSTREAM_TIMEOUT_MS = 3_000;

type WebEnvironment = Readonly<Record<string, string | undefined>>;

/** Recurrence evidence that the browser may display without tenant authority. */
export type HabitRecurrenceView =
  | Readonly<{ kind: 'daily'; interval: number }>
  | Readonly<{
      kind: 'weekly';
      interval: number;
      weekdays: readonly number[];
    }>;

/** Browser-safe projection of one durable Habit aggregate. */
export interface HabitView {
  id: string;
  title: string;
  timezone: string;
  startsOn: string;
  recurrence: HabitRecurrenceView;
  createdAt: string;
}

/** Minimal fetch dependency used by the Habit BFF and deterministic tests. */
export type HabitFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface HabitCreateInput {
  title: string;
  timezone: string;
  startsOn: string;
  recurrence: HabitRecurrenceView;
}

/** Returns one no-store browser problem without upstream implementation details. */
function problemResponse(
  status: number,
  title: string,
  code: string,
): Response {
  return Response.json(
    { type: 'about:blank', title, status, code },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/problem+json',
      },
    },
  );
}

/** Rejects malformed browser Habit input before dependency access. */
function invalidHabitRequest(): Response {
  return problemResponse(
    400,
    'Habit request is invalid',
    'invalid_habit_request',
  );
}

/** Hides Habit creation configuration, transport, or malformed evidence failures. */
function unavailableHabitCreation(): Response {
  return problemResponse(
    503,
    'Habit creation is unavailable',
    'habit_creation_unavailable',
  );
}

/** Hides Habit listing configuration, transport, or malformed evidence failures. */
function unavailableHabitListing(): Response {
  return problemResponse(
    503,
    'Habit listing is unavailable',
    'habit_listing_unavailable',
  );
}

/** Narrows unknown JSON to a non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Counts user-visible Unicode code points rather than UTF-16 code units. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** Requires exactly the reviewed fields and rejects hidden authority additions. */
function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  const actual = Object.keys(record);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    throw new Error('Habit evidence shape is invalid');
  }
}

/** Reads one body without allowing declared or actual bytes to exceed its budget. */
async function readBoundedText(
  message: Request | Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = message.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new Error('Habit message exceeds byte limit');
  }
  if (!message.body) {
    throw new Error('Habit message body is unavailable');
  }

  const reader = message.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let byteLength = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel('Habit message exceeds byte limit');
        throw new Error('Habit message exceeds byte limit');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    try {
      await reader.cancel('Habit message is invalid');
    } catch {
      // Cancellation is best-effort after the boundary has already failed closed.
    }
    throw new Error('Habit message is invalid');
  } finally {
    reader.releaseLock();
  }
  if (!body) {
    throw new Error('Habit message body is unavailable');
  }
  return body;
}

/** Reads bounded JSON while preserving case-insensitive HTTP media-type semantics. */
async function readBoundedJson(
  message: Request | Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = message.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw new Error('Habit JSON media type is required');
  }
  const body = await readBoundedText(message, maximumBytes);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Habit JSON body is invalid');
  }
}

/** Requires one canonical UUIDv4 from untrusted dependency evidence. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error('Habit identifier is invalid');
  }
  return value.toLowerCase();
}

/** Requires one bounded, trimmed, control-free Habit title. */
function requireTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Habit title is invalid');
  }
  const title = value.trim();
  if (
    !title ||
    title !== value ||
    /[\u0000-\u001f\u007f]/u.test(title) ||
    codePointLength(title) > MAXIMUM_TITLE_CHARACTERS ||
    Buffer.byteLength(title, 'utf8') > 1024
  ) {
    throw new Error('Habit title is invalid');
  }
  return title;
}

/** Requires a supported IANA timezone name without surrounding ambiguity. */
function requireTimezone(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Habit timezone is invalid');
  }
  const timezone = value.trim();
  if (
    !timezone ||
    timezone !== value ||
    /[\u0000-\u001f\u007f]/u.test(timezone) ||
    codePointLength(timezone) > MAXIMUM_TIMEZONE_CHARACTERS
  ) {
    throw new Error('Habit timezone is invalid');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new Error('Habit timezone is invalid');
  }
  return timezone;
}

/** Requires one real Gregorian local date in canonical YYYY-MM-DD form. */
function requireLocalDate(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Habit local date is invalid');
  }
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error('Habit local date is invalid');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Habit local date is invalid');
  }
  return value;
}

/** Requires one canonical timestamp for browser-visible durable evidence. */
function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    throw new Error('Habit timestamp is invalid');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Habit timestamp is invalid');
  }
  return new Date(parsed).toISOString();
}

/** Requires one safe recurrence interval inside the Habit domain contract. */
function requireInterval(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 365
  ) {
    throw new Error('Habit recurrence interval is invalid');
  }
  return value;
}

/** Parses and canonicalizes one daily or weekly recurrence contract. */
function parseRecurrence(value: unknown): HabitRecurrenceView {
  if (!isPlainObject(value)) {
    throw new Error('Habit recurrence is invalid');
  }
  if (value.kind === 'daily') {
    requireExactKeys(value, ['kind', 'interval']);
    return Object.freeze({
      kind: 'daily' as const,
      interval: requireInterval(value.interval),
    });
  }
  if (value.kind === 'weekly') {
    requireExactKeys(value, ['kind', 'interval', 'weekdays']);
    if (
      !Array.isArray(value.weekdays) ||
      value.weekdays.length === 0 ||
      value.weekdays.length > 7 ||
      value.weekdays.some(
        (weekday) =>
          typeof weekday !== 'number' ||
          !Number.isSafeInteger(weekday) ||
          weekday < 1 ||
          weekday > 7,
      )
    ) {
      throw new Error('Habit recurrence is invalid');
    }
    const weekdays = [...new Set(value.weekdays)].sort(
      (left, right) => left - right,
    );
    if (weekdays.length !== value.weekdays.length) {
      throw new Error('Habit recurrence is invalid');
    }
    return Object.freeze({
      kind: 'weekly' as const,
      interval: requireInterval(value.interval),
      weekdays: Object.freeze(weekdays),
    });
  }
  throw new Error('Habit recurrence is invalid');
}

/** Requires one fixed service origin without credentials, path, query, or fragment. */
function requireServiceOrigin(value: string | undefined): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Habit service origin is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Habit service origin is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Habit service origin is invalid');
  }
  return parsed.origin;
}

/** Requires the server-only HMAC key used to authenticate Habit workspace context. */
function requireGatewaySecret(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    /[\r\n\u0000]/u.test(value)
  ) {
    throw new Error('Habit gateway context secret is invalid');
  }
  return value;
}

/** Extracts only the authorized workspace from Identity session evidence. */
function parseSessionWorkspace(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new Error('Identity session response is invalid');
  }
  return requireUuid(value.workspaceId);
}

/** Accepts a bounded browser cookie only for Identity session introspection. */
function requireCookieHeader(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? undefined;
  if (
    cookie !== undefined &&
    (Buffer.byteLength(cookie, 'utf8') > MAXIMUM_COOKIE_BYTES ||
      /[\r\n\u0000]/u.test(cookie))
  ) {
    throw new Error('Habit cookie header is invalid');
  }
  return cookie;
}

/** Creates trusted Habit headers without admitting undefined HTTP values. */
function requestHeaders(entries: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/** Creates the exact short-lived workspace context verified by Habit service. */
function createHabitContextHeaders(
  workspaceId: string,
  secret: string,
  nowSeconds: number,
): Readonly<Record<string, string>> {
  const safeWorkspaceId = requireUuid(workspaceId);
  const safeSecret = requireGatewaySecret(secret);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Habit gateway context timestamp is invalid');
  }
  const issuedAt = String(nowSeconds);
  const signature = createHmac('sha256', safeSecret)
    .update(
      `life-os.workspace.v1\n${safeWorkspaceId}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
  return Object.freeze({
    'x-life-os-workspace-id': safeWorkspaceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  });
}

/** Parses one browser create command and excludes all tenant authority fields. */
async function parseBrowserCreateRequest(
  request: Request,
): Promise<HabitCreateInput> {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.search) {
    throw new Error('Habit request is invalid');
  }
  const value = await readBoundedJson(request, MAXIMUM_REQUEST_BYTES);
  if (!isPlainObject(value)) {
    throw new Error('Habit request is invalid');
  }
  requireExactKeys(value, ['title', 'timezone', 'startsOn', 'recurrence']);
  return Object.freeze({
    title: requireTitle(value.title),
    timezone: requireTimezone(value.timezone),
    startsOn: requireLocalDate(value.startsOn),
    recurrence: parseRecurrence(value.recurrence),
  });
}

/** Validates one Habit aggregate and strips workspace authority from browser output. */
function parseHabitRecord(
  value: unknown,
  expectedWorkspaceId: string,
): HabitView {
  if (!isPlainObject(value)) {
    throw new Error('Habit response is invalid');
  }
  requireExactKeys(value, [
    'id',
    'workspaceId',
    'title',
    'timezone',
    'startsOn',
    'recurrence',
    'createdAt',
  ]);
  const workspaceId = requireUuid(value.workspaceId);
  if (workspaceId !== expectedWorkspaceId) {
    throw new Error('Habit response ownership is invalid');
  }
  return Object.freeze({
    id: requireUuid(value.id),
    title: requireTitle(value.title),
    timezone: requireTimezone(value.timezone),
    startsOn: requireLocalDate(value.startsOn),
    recurrence: parseRecurrence(value.recurrence),
    createdAt: requireTimestamp(value.createdAt),
  });
}

/** Ensures create evidence reflects the exact canonical command accepted by the BFF. */
function parseCreatedHabit(
  value: unknown,
  expectedWorkspaceId: string,
  expected: HabitCreateInput,
): HabitView {
  const habit = parseHabitRecord(value, expectedWorkspaceId);
  if (
    habit.title !== expected.title ||
    habit.timezone !== expected.timezone ||
    habit.startsOn !== expected.startsOn ||
    JSON.stringify(habit.recurrence) !== JSON.stringify(expected.recurrence)
  ) {
    throw new Error('Habit create evidence disagrees with the command');
  }
  return habit;
}

/** Validates a bounded Habit collection and rejects duplicate aggregate identities. */
function parseHabitCollection(
  value: unknown,
  expectedWorkspaceId: string,
): HabitView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_HABITS) {
    throw new Error('Habit collection is invalid');
  }
  const habits = value.map((habit) =>
    parseHabitRecord(habit, expectedWorkspaceId),
  );
  const ids = new Set(habits.map((habit) => habit.id));
  if (ids.size !== habits.length) {
    throw new Error('Habit collection contains duplicate identities');
  }
  return habits;
}

/**
 * Creates one durable Habit through the authenticated first-party web boundary.
 * Browser credentials terminate at Identity. Habit service receives only the
 * server-derived workspace context, bounded domain command, and correlation ID.
 */
export async function handleHabitCreateRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: HabitFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let input: HabitCreateInput;
  let cookie: string | undefined;
  try {
    input = await parseBrowserCreateRequest(request);
    cookie = requireCookieHeader(request);
  } catch {
    return invalidHabitRequest();
  }

  try {
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
    );
    const habitOrigin = requireServiceOrigin(environment.HABIT_SERVICE_ORIGIN);
    const contextSecret = requireGatewaySecret(
      environment.HABIT_GATEWAY_CONTEXT_SECRET,
    );
    const correlationId = randomUUID();

    const identityResponse = await fetcher(
      new URL('/v1/session', identityOrigin),
      {
        method: 'GET',
        headers: requestHeaders({
          cookie,
          'x-correlation-id': correlationId,
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (identityResponse.status === 401) {
      return problemResponse(
        401,
        'Authentication is required',
        'authentication_required',
      );
    }
    if (identityResponse.status !== 200) {
      return unavailableHabitCreation();
    }
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const contextHeaders = createHabitContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
    );

    const habitResponse = await fetcher(new URL('/v1/habits', habitOrigin), {
      method: 'POST',
      headers: requestHeaders({
        ...contextHeaders,
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      }),
      body: JSON.stringify(input),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (habitResponse.status === 400) {
      return invalidHabitRequest();
    }
    if (habitResponse.status !== 201) {
      return unavailableHabitCreation();
    }
    const habit = parseCreatedHabit(
      await readBoundedJson(habitResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
      input,
    );
    return Response.json(habit, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableHabitCreation();
  }
}

/**
 * Lists durable Habits through the authenticated first-party web boundary.
 * Every returned aggregate is checked against the Identity-derived workspace
 * before its authority field is removed from browser-visible evidence.
 */
export async function handleHabitListRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: HabitFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let cookie: string | undefined;
  try {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.search) {
      return invalidHabitRequest();
    }
    cookie = requireCookieHeader(request);
  } catch {
    return invalidHabitRequest();
  }

  try {
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
    );
    const habitOrigin = requireServiceOrigin(environment.HABIT_SERVICE_ORIGIN);
    const contextSecret = requireGatewaySecret(
      environment.HABIT_GATEWAY_CONTEXT_SECRET,
    );
    const correlationId = randomUUID();

    const identityResponse = await fetcher(
      new URL('/v1/session', identityOrigin),
      {
        method: 'GET',
        headers: requestHeaders({
          cookie,
          'x-correlation-id': correlationId,
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (identityResponse.status === 401) {
      return problemResponse(
        401,
        'Authentication is required',
        'authentication_required',
      );
    }
    if (identityResponse.status !== 200) {
      return unavailableHabitListing();
    }
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const contextHeaders = createHabitContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
    );

    const habitResponse = await fetcher(new URL('/v1/habits', habitOrigin), {
      method: 'GET',
      headers: requestHeaders({
        ...contextHeaders,
        'x-correlation-id': correlationId,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (habitResponse.status !== 200) {
      return unavailableHabitListing();
    }
    const habits = parseHabitCollection(
      await readBoundedJson(habitResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
    );
    return Response.json(habits, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableHabitListing();
  }
}
