import { createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_TODAY_ACTIONS = 50;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const UPSTREAM_TIMEOUT_MS = 3_000;

/** Environment values required by the bounded Gateway -> Identity -> Planning path. */
export interface GatewayTodayEnvironment {
  readonly IDENTITY_SERVICE_ORIGIN?: string;
  readonly PLANNING_SERVICE_ORIGIN?: string;
  readonly PLANNING_GATEWAY_CONTEXT_SECRET?: string;
}

/** Minimal fetch surface used by production composition and deterministic tests. */
export type GatewayTodayFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Validated Planning-owned Today aggregate carried without cross-service persistence reads. */
export interface GatewayPlanningToday {
  readonly version: 'life-os.today.v1';
  readonly aggregateId: string;
  readonly revision: string;
  readonly date: string;
  readonly actions: readonly unknown[];
}

/** Buyer-visible Gateway response while Habit composition remains explicitly degraded. */
export interface GatewayTodayView {
  readonly version: 'life-os.gateway-today.v1';
  readonly date: string;
  readonly planning: GatewayPlanningToday;
  readonly degraded: readonly ['habits_not_composed'];
}

/** Credential-free typed failure translated by the public HTTP boundary. */
export class GatewayTodayError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 503,
    readonly code:
      | 'invalid_today_request'
      | 'authentication_required'
      | 'today_not_found'
      | 'today_composition_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayTodayError';
  }
}

function invalidRequest(): GatewayTodayError {
  return new GatewayTodayError(
    400,
    'invalid_today_request',
    'Today composition request is invalid',
  );
}

function unavailable(): GatewayTodayError {
  return new GatewayTodayError(
    503,
    'today_composition_unavailable',
    'Today composition is unavailable',
  );
}

function requireDate(value: string): string {
  if (!DATE_PATTERN.test(value)) throw invalidRequest();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw invalidRequest();
  }
  return value;
}

function requireCookie(value: string | undefined): string | undefined {
  if (
    value !== undefined &&
    (Buffer.byteLength(value, 'utf8') > MAXIMUM_COOKIE_BYTES ||
      /[\r\n\u0000]/u.test(value))
  ) {
    throw invalidRequest();
  }
  return value;
}

function requireServiceOrigin(value: string | undefined): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw unavailable();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw unavailable();
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw unavailable();
  }
  return parsed.origin;
}

function requireGatewaySecret(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    /[\r\n\u0000]/u.test(value)
  ) {
    throw unavailable();
  }
  return value;
}

function requireWorkspaceId(value: unknown): string {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).workspaceId !== 'string' ||
    !UUID_V4_PATTERN.test(
      (value as Record<string, unknown>).workspaceId as string,
    )
  ) {
    throw unavailable();
  }
  return ((value as Record<string, unknown>).workspaceId as string).toLowerCase();
}

function requireNowSeconds(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
  return value;
}

function serviceHeaders(
  entries: Readonly<Record<string, string | undefined>>,
): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_RESPONSE_BYTES)
  ) {
    throw unavailable();
  }
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let byteLength = 0;
  let body = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel('Gateway upstream response exceeds byte limit');
        throw unavailable();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    try {
      await reader.cancel('Gateway upstream response is invalid');
    } catch {
      // Stream cancellation is best-effort after an upstream read failure.
    }
    if (error instanceof GatewayTodayError) throw error;
    throw unavailable();
  } finally {
    reader.releaseLock();
  }
  if (!body) throw unavailable();
  return body;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw unavailable();
  }
  try {
    return JSON.parse(await readBoundedText(response)) as unknown;
  } catch (error) {
    if (error instanceof GatewayTodayError) throw error;
    throw unavailable();
  }
}

function requirePlanningToday(
  value: unknown,
  expectedDate: string,
): GatewayPlanningToday {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unavailable();
  }
  const record = value as Record<string, unknown>;
  const exactKeys = ['version', 'aggregateId', 'revision', 'date', 'actions'];
  if (
    Object.keys(record).length !== exactKeys.length ||
    exactKeys.some((key) => !Object.hasOwn(record, key)) ||
    record.version !== 'life-os.today.v1' ||
    record.date !== expectedDate ||
    typeof record.aggregateId !== 'string' ||
    !UUID_V4_PATTERN.test(record.aggregateId) ||
    typeof record.revision !== 'string' ||
    !UUID_V4_PATTERN.test(record.revision) ||
    !Array.isArray(record.actions) ||
    record.actions.length > MAXIMUM_TODAY_ACTIONS
  ) {
    throw unavailable();
  }
  return Object.freeze({
    version: 'life-os.today.v1',
    aggregateId: record.aggregateId.toLowerCase(),
    revision: record.revision.toLowerCase(),
    date: expectedDate,
    actions: Object.freeze([...record.actions]),
  });
}

function planningContextHeaders(
  workspaceId: string,
  secret: string,
  nowSeconds: number,
): Readonly<Record<string, string>> {
  const issuedAt = String(requireNowSeconds(nowSeconds));
  const signature = createHmac('sha256', secret)
    .update(`life-os.workspace.v1\n${workspaceId}\n${issuedAt}`, 'utf8')
    .digest('base64url');
  return Object.freeze({
    'x-life-os-workspace-id': workspaceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  });
}

/**
 * Authenticates the browser session with Identity, derives workspace authority,
 * and reads validated Planning-owned Today state without forwarding credentials.
 */
export async function composePlanningToday(
  cookie: string | undefined,
  date: string,
  environment: GatewayTodayEnvironment,
  fetcher: GatewayTodayFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<GatewayTodayView> {
  const safeDate = requireDate(date);
  const safeCookie = requireCookie(cookie);
  const identityOrigin = requireServiceOrigin(
    environment.IDENTITY_SERVICE_ORIGIN,
  );
  const planningOrigin = requireServiceOrigin(
    environment.PLANNING_SERVICE_ORIGIN,
  );
  const secret = requireGatewaySecret(
    environment.PLANNING_GATEWAY_CONTEXT_SECRET,
  );
  const correlationId = randomUUID();

  let identityResponse: Response;
  try {
    identityResponse = await fetcher(new URL('/v1/session', identityOrigin), {
      method: 'GET',
      headers: serviceHeaders({
        cookie: safeCookie,
        'x-correlation-id': correlationId,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }
  if (identityResponse.status === 401) {
    throw new GatewayTodayError(
      401,
      'authentication_required',
      'Authentication is required',
    );
  }
  if (identityResponse.status !== 200) throw unavailable();
  const workspaceId = requireWorkspaceId(await readBoundedJson(identityResponse));

  let planningResponse: Response;
  try {
    planningResponse = await fetcher(
      new URL(`/v1/today/${safeDate}`, planningOrigin),
      {
        method: 'GET',
        headers: serviceHeaders({
          ...planningContextHeaders(workspaceId, secret, nowSeconds),
          'x-correlation-id': correlationId,
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
  } catch {
    throw unavailable();
  }
  if (planningResponse.status === 404) {
    throw new GatewayTodayError(
      404,
      'today_not_found',
      'Today aggregate was not found',
    );
  }
  if (planningResponse.status !== 200) throw unavailable();
  const planning = requirePlanningToday(
    await readBoundedJson(planningResponse),
    safeDate,
  );

  return Object.freeze({
    version: 'life-os.gateway-today.v1',
    date: safeDate,
    planning,
    degraded: Object.freeze(['habits_not_composed'] as const),
  });
}
