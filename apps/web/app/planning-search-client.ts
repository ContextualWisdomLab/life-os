import { randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_RESPONSE_BYTES = 16 * 1024;
const MAXIMUM_QUERY_CHARACTERS = 120;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_RESULTS = 50;
const UPSTREAM_TIMEOUT_MS = 3_000;

export interface PlanningSearchView {
  entityType: 'goal' | 'project' | 'task';
  id: string;
  title: string;
  parentId?: string;
  status?: 'todo' | 'done';
  createdAt: string;
}

export type PlanningSearchFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type WebEnvironment = Readonly<Record<string, string | undefined>>;

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

function invalidSearchRequest(): Response {
  return problemResponse(
    400,
    'Planning search request is invalid',
    'invalid_search_request',
  );
}

function unavailableSearch(): Response {
  return problemResponse(
    503,
    'Planning search is unavailable',
    'planning_search_unavailable',
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function codePointLength(value: string): number {
  return [...value].length;
}

function requireUuid(value: unknown, message: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error(message);
  }
  return value.toLowerCase();
}

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

export function parseSessionWorkspace(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new Error('Identity session response is invalid');
  }
  return requireUuid(value.workspaceId, 'Identity session response is invalid');
}

function parseResult(value: unknown): PlanningSearchView {
  if (!isPlainObject(value)) {
    throw new Error('Planning search response is invalid');
  }
  const entityType = value.entityType;
  if (entityType !== 'goal' && entityType !== 'project' && entityType !== 'task') {
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

export function parsePlanningSearchResults(value: unknown): PlanningSearchView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_RESULTS) {
    throw new Error('Planning search response is invalid');
  }
  return value.map(parseResult);
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0];
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw new Error('Upstream response is invalid');
  }
  const body = await response.text();
  if (
    !body ||
    Buffer.byteLength(body, 'utf8') > MAXIMUM_RESPONSE_BYTES
  ) {
    throw new Error('Upstream response is invalid');
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Upstream response is invalid');
  }
}

function parseBrowserQuery(url: URL): { query: string; limit: number } | undefined {
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

function requestHeaders(entries: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

export async function handlePlanningSearchRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: PlanningSearchFetch = fetch,
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
    const planningResponse = await fetcher(planningUrl, {
      method: 'GET',
      headers: requestHeaders({
        'x-workspace-id': workspaceId,
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
