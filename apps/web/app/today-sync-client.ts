import { randomUUID } from 'node:crypto';
import {
  createPlanningContextHeaders,
  parseSessionWorkspace,
  requireGatewaySecret,
  requireServiceOrigin,
} from './planning-search-client';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_BROWSER_BODY_BYTES = 64 * 1024;
const MAXIMUM_UPSTREAM_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 3_000;

type WebEnvironment = Readonly<Record<string, string | undefined>>;
export type TodaySyncFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface TodayProblem {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly currentRevision?: string | null;
}

/** Returns one no-store problem response without dependency details. */
function problemResponse(
  status: number,
  title: string,
  code: string,
  currentRevision?: string | null,
): Response {
  const body: TodayProblem = {
    type: 'about:blank',
    title,
    status,
    code,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/problem+json',
    },
  });
}

/** Returns the fixed browser input failure. */
function invalidRequest(): Response {
  return problemResponse(
    400,
    'Today synchronization request is invalid',
    'invalid_today_request',
  );
}

/** Returns the fixed dependency failure. */
function unavailable(): Response {
  return problemResponse(
    503,
    'Today synchronization is unavailable',
    'today_sync_unavailable',
  );
}

/** Accepts one real canonical local calendar date. */
function requireDate(value: string): string {
  if (!DATE_PATTERN.test(value)) throw new Error('invalid date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error('invalid date');
  }
  return value;
}

/** Accepts one bounded cookie header without header-injection bytes. */
function requireCookie(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? undefined;
  if (
    cookie !== undefined &&
    (Buffer.byteLength(cookie, 'utf8') > MAXIMUM_COOKIE_BYTES ||
      /[\r\n\u0000]/u.test(cookie))
  ) {
    throw new Error('invalid cookie');
  }
  return cookie;
}

/** Reads one body with a strict byte cap before returning text. */
async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes)
  ) {
    throw new Error('body too large');
  }
  if (!response.body) throw new Error('missing body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel('body too large');
        throw new Error('body too large');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!body) throw new Error('missing body');
  return body;
}

/** Reads bounded JSON from an allowed JSON media type. */
async function readBoundedJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0];
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw new Error('invalid media type');
  }
  return JSON.parse(await readBoundedText(response, maximumBytes)) as unknown;
}

/** Reads and validates the complete browser PUT body before contacting identity. */
async function readBrowserPutBody(
  request: Request,
  date: string,
): Promise<string> {
  if (
    request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json'
  ) {
    throw new Error('invalid media type');
  }
  if (request.body === null) throw new Error('missing body');
  const browserResponse = new Response(request.body);
  const text = await readBoundedText(
    browserResponse,
    MAXIMUM_BROWSER_BODY_BYTES,
  );
  const parsed = JSON.parse(text) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).version !== 'life-os.today.v1' ||
    (parsed as Record<string, unknown>).date !== date ||
    !Array.isArray((parsed as Record<string, unknown>).actions)
  ) {
    throw new Error('invalid body');
  }
  return JSON.stringify(parsed);
}

/** Requires a strong revision ETag returned by planning-service. */
function requireEtag(value: string | null): string {
  const match = /^"([0-9a-f-]+)"$/iu.exec(value ?? '');
  if (!match?.[1] || !UUID_V4_PATTERN.test(match[1])) {
    throw new Error('invalid etag');
  }
  return `"${match[1].toLowerCase()}"`;
}

/** Restricts browser write authority to one strong match or explicit create. */
function requireWriteHeaders(
  request: Request,
): Readonly<Record<string, string>> {
  const ifMatch = request.headers.get('if-match');
  const ifNoneMatch = request.headers.get('if-none-match');
  const idempotencyKey = request.headers.get('idempotency-key');
  if (
    !idempotencyKey ||
    !UUID_V4_PATTERN.test(idempotencyKey) ||
    (ifMatch === null && ifNoneMatch === null) ||
    (ifMatch !== null && ifNoneMatch !== null)
  ) {
    throw new Error('invalid write headers');
  }
  if (ifNoneMatch !== null) {
    if (ifNoneMatch !== '*') throw new Error('invalid create precondition');
    return Object.freeze({
      'if-none-match': '*',
      'idempotency-key': idempotencyKey.toLowerCase(),
    });
  }
  const etag = requireEtag(ifMatch);
  return Object.freeze({
    'if-match': etag,
    'idempotency-key': idempotencyKey.toLowerCase(),
  });
}

/** Creates headers without copying arbitrary browser-selected authority. */
function headers(
  entries: Readonly<Record<string, string | undefined>>,
): Headers {
  const result = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) result.set(name, value);
  }
  return result;
}

/** Narrows a dependency revision conflict to fields the UI is allowed to reconcile. */
function parseRevisionConflict(value: unknown): string | null | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.type !== 'about:blank' ||
    record.status !== 409 ||
    record.code !== 'today_revision_conflict' ||
    record.title !== 'Today changed on another device'
  ) {
    return undefined;
  }
  if (record.currentRevision === null) return null;
  if (
    typeof record.currentRevision === 'string' &&
    UUID_V4_PATTERN.test(record.currentRevision)
  ) {
    return record.currentRevision.toLowerCase();
  }
  return undefined;
}

/** Validates the upstream Today aggregate before returning it to the browser. */
function parseAggregate(
  value: unknown,
  expectedDate: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid aggregate');
  }
  const record = value as Record<string, unknown>;
  const keys = ['version', 'aggregateId', 'revision', 'date', 'actions'];
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key)) ||
    record.version !== 'life-os.today.v1' ||
    record.date !== expectedDate ||
    typeof record.aggregateId !== 'string' ||
    !UUID_V4_PATTERN.test(record.aggregateId) ||
    typeof record.revision !== 'string' ||
    !UUID_V4_PATTERN.test(record.revision) ||
    !Array.isArray(record.actions) ||
    record.actions.length > 50
  ) {
    throw new Error('invalid aggregate');
  }
  return record;
}

/**
 * Authenticates via identity, derives workspace scope server-side, signs a
 * short-lived planning context, and proxies bounded Today GET/PUT operations.
 */
export async function handleTodaySyncRequest(
  request: Request,
  date: string,
  environment: WebEnvironment,
  fetcher: TodaySyncFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let safeDate: string;
  let putBody: string | undefined;
  let writeHeaders: Readonly<Record<string, string>> = {};
  try {
    safeDate = requireDate(date);
    if (request.method !== 'GET' && request.method !== 'PUT') {
      return invalidRequest();
    }
    if (request.method === 'PUT') {
      writeHeaders = requireWriteHeaders(request);
      putBody = await readBrowserPutBody(request, safeDate);
    }
  } catch {
    return invalidRequest();
  }

  try {
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
    );
    const planningOrigin = requireServiceOrigin(
      environment.PLANNING_SERVICE_ORIGIN,
    );
    const secret = requireGatewaySecret(
      environment.PLANNING_GATEWAY_CONTEXT_SECRET,
    );
    const cookie = requireCookie(request);
    const correlationId = randomUUID();
    const identityResponse = await fetcher(
      new URL('/v1/session', identityOrigin),
      {
        method: 'GET',
        headers: headers({ cookie, 'x-correlation-id': correlationId }),
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
    if (identityResponse.status !== 200) return unavailable();
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_UPSTREAM_BODY_BYTES),
    );
    const planningContext = createPlanningContextHeaders(
      workspaceId,
      secret,
      nowSeconds,
    );
    const planningResponse = await fetcher(
      new URL(`/v1/today/${safeDate}`, planningOrigin),
      {
        method: request.method,
        headers: headers({
          ...planningContext,
          ...writeHeaders,
          ...(request.method === 'PUT'
            ? { 'content-type': 'application/json' }
            : {}),
          'x-correlation-id': correlationId,
        }),
        ...(request.method === 'PUT' && putBody !== undefined
          ? { body: putBody }
          : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (planningResponse.status === 404 && request.method === 'GET') {
      return problemResponse(
        404,
        'Today aggregate was not found',
        'today_not_found',
      );
    }
    if (planningResponse.status === 409) {
      const conflict = parseRevisionConflict(
        await readBoundedJson(planningResponse, MAXIMUM_UPSTREAM_BODY_BYTES),
      );
      if (conflict !== undefined) {
        return problemResponse(
          409,
          'Today changed on another device',
          'today_revision_conflict',
          conflict,
        );
      }
      return problemResponse(
        409,
        'Today write conflicts with an earlier request',
        'today_write_conflict',
      );
    }
    if (planningResponse.status !== 200 && planningResponse.status !== 201) {
      return unavailable();
    }
    const aggregate = parseAggregate(
      await readBoundedJson(planningResponse, MAXIMUM_UPSTREAM_BODY_BYTES),
      safeDate,
    );
    const etag = requireEtag(planningResponse.headers.get('etag'));
    if (`"${String(aggregate.revision).toLowerCase()}"` !== etag) {
      return unavailable();
    }
    return Response.json(aggregate, {
      status: planningResponse.status,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        etag,
        'x-correlation-id': correlationId,
      },
    });
  } catch {
    return unavailable();
  }
}
