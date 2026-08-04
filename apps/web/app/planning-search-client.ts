import { createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_RESPONSE_BYTES = 16 * 1024;
const MINIMUM_QUERY_CHARACTERS = 2;
const MAXIMUM_QUERY_CHARACTERS = 120;
const MAXIMUM_QUERY_TOKENS = 8;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_RESULTS = 25;
const MINIMUM_CONTEXT_SECRET_BYTES = 32;
const UPSTREAM_TIMEOUT_MS = 3_000;

/** Browser-safe representation of one durable planning search result. */
export interface PlanningSearchView {
  entityType: 'goal' | 'project' | 'task';
  id: string;
  title: string;
  parentId?: string;
  status?: 'todo' | 'done';
  createdAt: string;
}

/** Fetch-compatible dependency used by the BFF and its deterministic tests. */
export type PlanningSearchFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Environment values required by the planning-search BFF. */
type WebEnvironment = Readonly<Record<string, string | undefined>>;

/** Returns a bounded, cache-disabled RFC 9457-style problem response. */
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

/** Returns the stable public response for invalid browser search input. */
function invalidSearchRequest(): Response {
  return problemResponse(
    400,
    'Planning search request is invalid',
    'invalid_search_request',
  );
}

/** Returns the stable public response for upstream or configuration failure. */
function unavailableSearch(): Response {
  return problemResponse(
    503,
    'Planning search is unavailable',
    'planning_search_unavailable',
  );
}

/** Narrows an untrusted value to an ordinary non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Counts Unicode code points instead of UTF-16 code units. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** Requires one UUIDv4 value and normalizes hexadecimal case. */
function requireUuid(value: unknown, message: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error(message);
  }
  return value.toLowerCase();
}

/** Requires a valid RFC 3339 timestamp and canonicalizes it to UTC. */
function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    throw new Error('Planning search response is invalid');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Planning search response is invalid');
  }
  return new Date(parsed).toISOString();
}

/** Requires a bounded control-character-free display title. */
function requireTitle(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    codePointLength(value) > MAXIMUM_TITLE_CHARACTERS ||
    Buffer.byteLength(value, 'utf8') > 1024
  ) {
    throw new Error('Planning search response is invalid');
  }
  return value;
}

/** Validates an internal service origin without accepting credentials or paths. */
export function requireServiceOrigin(
  value: string | undefined,
  _serviceName: string,
): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Service origin is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Service origin is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Service origin is invalid');
  }
  return parsed.origin;
}

/** Requires a high-entropy shared secret for signed internal workspace context. */
export function requireGatewayContextSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') < MINIMUM_CONTEXT_SECRET_BYTES ||
    /[\r\n\u0000]/.test(value)
  ) {
    throw new Error('Gateway context secret is invalid');
  }
  return value;
}

/** Extracts only the workspace identifier from a validated identity session. */
export function parseSessionWorkspace(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new Error('Identity session response is invalid');
  }
  return requireUuid(value.workspaceId, 'Identity session response is invalid');
}

/** Creates the short-lived signed headers accepted by planning-service search. */
export function createWorkspaceContextHeaders(
  workspaceId: string,
  secret: string,
  issuedAtSeconds: number,
): Record<string, string> {
  const safeWorkspaceId = requireUuid(
    workspaceId,
    'Workspace context input is invalid',
  );
  const safeSecret = requireGatewayContextSecret(secret);
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds < 0) {
    throw new Error('Workspace context input is invalid');
  }
  const issuedAt = String(issuedAtSeconds);
  const signature = createHmac('sha256', safeSecret)
    .update(`life-os.workspace.v1\n${safeWorkspaceId}\n${issuedAt}`, 'utf8')
    .digest('base64url');
  return {
    'x-life-os-workspace-id': safeWorkspaceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  };
}

/** Parses one untrusted planning-service result into its closed entity shape. */
function parseResult(value: unknown): PlanningSearchView {
  if (!isPlainObject(value)) {
    throw new Error('Planning search response is invalid');
  }
  const entityType = value.entityType;
  if (
    entityType !== 'goal' &&
    entityType !== 'project' &&
    entityType !== 'task'
  ) {
    throw new Error('Planning search response is invalid');
  }
  const result: PlanningSearchView = {
    entityType,
    id: requireUuid(value.id, 'Planning search response is invalid'),
    title: requireTitle(value.title),
    createdAt: requireTimestamp(value.createdAt),
  };
  if (entityType === 'goal') {
    if (value.parentId !== undefined || value.status !== undefined) {
      throw new Error('Planning search response is invalid');
    }
    return result;
  }
  result.parentId = requireUuid(
    value.parentId,
    'Planning search response is invalid',
  );
  if (entityType === 'project') {
    if (value.status !== undefined) {
      throw new Error('Planning search response is invalid');
    }
    return result;
  }
  if (value.status !== 'todo' && value.status !== 'done') {
    throw new Error('Planning search response is invalid');
  }
  result.status = value.status;
  return result;
}

/** Parses a bounded planning-service result list without exposing extra fields. */
export function parsePlanningSearchResults(
  value: unknown,
): PlanningSearchView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_RESULTS) {
    throw new Error('Planning search response is invalid');
  }
  return value.map(parseResult);
}

/** Reads a small JSON response while rejecting unexpected media types and sizes. */
async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0];
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw new Error('Upstream response is invalid');
  }
  const body = await response.text();
  if (!body || Buffer.byteLength(body, 'utf8') > MAXIMUM_RESPONSE_BYTES) {
    throw new Error('Upstream response is invalid');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Upstream response is invalid');
  }
}

/** Parses the browser query using the same public bounds as planning-service. */
function parseBrowserQuery(
  url: URL,
): { query: string; limit: number } | undefined {
  const keys = [...new Set(url.searchParams.keys())];
  if (keys.some((key) => key !== 'q' && key !== 'limit')) {
    return undefined;
  }
  const queryValues = url.searchParams.getAll('q');
  const limitValues = url.searchParams.getAll('limit');
  if (queryValues.length !== 1 || limitValues.length > 1) {
    return undefined;
  }
  const query = queryValues[0]?.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  const tokens = query?.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    !query ||
    /[\u0000-\u001f\u007f]/.test(query) ||
    /^\d+$/u.test(query) ||
    codePointLength(query) < MINIMUM_QUERY_CHARACTERS ||
    codePointLength(query) > MAXIMUM_QUERY_CHARACTERS ||
    new Set(tokens).size === 0 ||
    new Set(tokens).size > MAXIMUM_QUERY_TOKENS ||
    Buffer.byteLength(query, 'utf8') > 512
  ) {
    return undefined;
  }
  const limitValue = limitValues[0] ?? '20';
  if (!/^[1-9]\d*$/.test(limitValue)) {
    return undefined;
  }
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit > MAXIMUM_RESULTS) {
    return undefined;
  }
  return { query, limit };
}

/** Returns a bounded cookie header for the identity-session lookup only. */
function requireCookieHeader(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? undefined;
  if (
    cookie !== undefined &&
    (Buffer.byteLength(cookie, 'utf8') > MAXIMUM_COOKIE_BYTES ||
      /[\r\n\u0000]/.test(cookie))
  ) {
    throw new Error('Cookie header is invalid');
  }
  return cookie;
}

/** Builds a minimal header set while omitting undefined values. */
function requestHeaders(entries: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

/**
 * Derives workspace ownership from the authenticated identity session, signs a
 * short-lived internal context, and proxies a bounded planning search result.
 */
export async function handlePlanningSearchRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: PlanningSearchFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  const parsedQuery = parseBrowserQuery(new URL(request.url));
  if (!parsedQuery) {
    return invalidSearchRequest();
  }

  try {
    const identityOrigin = requireServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
      'identity',
    );
    const planningOrigin = requireServiceOrigin(
      environment.PLANNING_SERVICE_ORIGIN,
      'planning',
    );
    const contextSecret = requireGatewayContextSecret(
      environment.PLANNING_GATEWAY_CONTEXT_SECRET,
    );
    const cookie = requireCookieHeader(request);
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
      return unavailableSearch();
    }
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse),
    );

    const planningUrl = new URL('/v1/search', planningOrigin);
    planningUrl.searchParams.set('q', parsedQuery.query);
    planningUrl.searchParams.set('limit', String(parsedQuery.limit));
    const workspaceHeaders = createWorkspaceContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
    );
    const planningResponse = await fetcher(planningUrl, {
      method: 'GET',
      headers: requestHeaders({
        ...workspaceHeaders,
        'x-correlation-id': correlationId,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (planningResponse.status !== 200) {
      return unavailableSearch();
    }
    const results = parsePlanningSearchResults(
      await readBoundedJson(planningResponse),
    );
    return Response.json(results, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      },
    });
  } catch {
    return unavailableSearch();
  }
}
