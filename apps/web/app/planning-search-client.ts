import { createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_RESPONSE_BYTES = 16 * 1024;
const MAXIMUM_QUERY_CHARACTERS = 120;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_RESULTS = 25;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const UPSTREAM_TIMEOUT_MS = 3_000;
const DEFAULT_PLANNING_BINDING = { method: 'GET', path: '/v1/search' } as const;

/** Credential-free planning record exposed to the browser. */
export interface PlanningSearchView {
  entityType: 'goal' | 'project' | 'task';
  id: string;
  title: string;
  parentId?: string;
  status?: 'todo' | 'done';
  createdAt: string;
}

/** Server-owned request identity included in a Planning workspace signature. */
export interface PlanningContextRequestBinding {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
}

/** Minimal fetch surface used by the production BFF and deterministic tests. */
export type PlanningSearchFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type WebEnvironment = Readonly<Record<string, string | undefined>>;

/** Builds a no-store RFC 9457-compatible response without upstream details. */
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

/** Returns the stable browser-facing validation failure. */
function invalidSearchRequest(): Response {
  return problemResponse(
    400,
    'Planning search request is invalid',
    'invalid_search_request',
  );
}

/** Returns the stable browser-facing upstream failure. */
function unavailableSearch(): Response {
  return problemResponse(
    503,
    'Planning search is unavailable',
    'planning_search_unavailable',
  );
}

/** Narrows untrusted JSON to a non-array record. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Counts Unicode code points rather than UTF-16 code units. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** Requires one canonical opaque UUIDv4 value. */
function requireUuid(value: unknown, message: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error(message);
  }
  return value.toLowerCase();
}

/** Requires one valid timestamp and returns canonical UTC ISO 8601. */
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

/** Requires a bounded, nonblank, control-free display title. */
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

/** Requires a fixed service origin with no credentials, path, query, or fragment. */
export function requireServiceOrigin(value: string | undefined): string {
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

/** Requires the shared HMAC secret used only between the BFF and planning service. */
export function requireGatewaySecret(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    /[\r\n\u0000]/.test(value)
  ) {
    throw new Error('Gateway context secret is invalid');
  }
  return value;
}

/** Extracts the authorized workspace from identity-session introspection. */
export function parseSessionWorkspace(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new Error('Identity session response is invalid');
  }
  return requireUuid(value.workspaceId, 'Identity session response is invalid');
}

/** Requires one bounded absolute Planning resource path without a query/fragment. */
function requirePlanningBinding(
  binding: PlanningContextRequestBinding,
): PlanningContextRequestBinding {
  if (
    !binding.path.startsWith('/v1/') ||
    binding.path.length > 256 ||
    /[\u0000-\u001f\u007f?#]/u.test(binding.path)
  ) {
    throw new Error('Planning request binding is invalid');
  }
  return binding;
}

/** Creates the exact short-lived request-bound context verified by planning-service. */
export function createPlanningContextHeaders(
  workspaceId: string,
  secret: string,
  nowSeconds: number,
  binding: PlanningContextRequestBinding = DEFAULT_PLANNING_BINDING,
): Readonly<Record<string, string>> {
  const safeWorkspaceId = requireUuid(
    workspaceId,
    'Identity session response is invalid',
  );
  const safeSecret = requireGatewaySecret(secret);
  const safeBinding = requirePlanningBinding(binding);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Gateway context timestamp is invalid');
  }
  const issuedAt = String(nowSeconds);
  const signature = createHmac('sha256', safeSecret)
    .update(
      `life-os.planning-context.v2\n${safeWorkspaceId}\n${issuedAt}\n${safeBinding.method}\n${safeBinding.path}`,
      'utf8',
    )
    .digest('base64url');
  return Object.freeze({
    'x-life-os-workspace-id': safeWorkspaceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  });
}

/** Parses one untrusted planning result into its entity-specific browser shape. */
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

/** Validates the complete bounded planning response before returning it. */
export function parsePlanningSearchResults(
  value: unknown,
): PlanningSearchView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_RESULTS) {
    throw new Error('Planning search response is invalid');
  }
  return value.map(parseResult);
}

/** Reads a response stream while enforcing the byte limit before buffering it. */
async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_RESPONSE_BYTES)
  ) {
    throw new Error('Upstream response is invalid');
  }
  if (!response.body) {
    throw new Error('Upstream response is invalid');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let byteLength = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel('Upstream response exceeds byte limit');
        throw new Error('Upstream response is invalid');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    try {
      await reader.cancel('Upstream response is invalid');
    } catch {
      // Cancellation is best-effort after a malformed or failed stream.
    }
    throw new Error('Upstream response is invalid');
  } finally {
    reader.releaseLock();
  }

  if (!body) {
    throw new Error('Upstream response is invalid');
  }
  return body;
}

/** Reads JSON only from allowed media types and within a fixed byte budget. */
async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0];
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw new Error('Upstream response is invalid');
  }
  const body = await readBoundedText(response);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Upstream response is invalid');
  }
}

/** Accepts only one bounded query and optional bounded limit. */
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
  if (
    !query ||
    codePointLength(query) < 2 ||
    /[\u0000-\u001f\u007f]/.test(query) ||
    /^\d+(?:\s+\d+)*$/u.test(query) ||
    codePointLength(query) > MAXIMUM_QUERY_CHARACTERS ||
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

/** Accepts a browser cookie only within one bounded, injection-safe header. */
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

/** Creates a header collection without undefined entries. */
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
 * Authenticates through identity, derives workspace ownership, signs a short-lived
 * service context, and returns validated planning results without forwarding the
 * browser credential to planning-service.
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
    );
    const planningOrigin = requireServiceOrigin(
      environment.PLANNING_SERVICE_ORIGIN,
    );
    const contextSecret = requireGatewaySecret(
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
    const contextHeaders = createPlanningContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
    );

    const planningUrl = new URL('/v1/search', planningOrigin);
    planningUrl.searchParams.set('q', parsedQuery.query);
    planningUrl.searchParams.set('limit', String(parsedQuery.limit));
    const planningResponse = await fetcher(planningUrl, {
      method: 'GET',
      headers: requestHeaders({
        ...contextHeaders,
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
