import { randomUUID } from 'node:crypto';
import {
  createPlanningContextHeaders,
  parseSessionWorkspace,
  requireGatewaySecret,
  requireServiceOrigin,
} from './planning-search-client';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_REQUEST_BYTES = 4 * 1024;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_TASKS = 100;
const UPSTREAM_TIMEOUT_MS = 3_000;

/** Browser-safe projection of one durable Planning task below a Project. */
export interface PlanningTaskView {
  id: string;
  projectId: string;
  title: string;
  status: 'todo' | 'done';
  createdAt: string;
}

/** Minimal HTTP dependency used by the Task BFF and deterministic tests. */
export type PlanningTaskFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type WebEnvironment = Readonly<Record<string, string | undefined>>;

/** Returns a browser-safe, non-cacheable problem without dependency details. */
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

/** Rejects malformed browser input before Identity or Planning can be called. */
function invalidTaskRequest(): Response {
  return problemResponse(400, 'Task request is invalid', 'invalid_task_request');
}

/** Hides Task creation configuration, transport, and malformed upstream failures. */
function unavailableTaskCreation(): Response {
  return problemResponse(
    503,
    'Task creation is unavailable',
    'task_creation_unavailable',
  );
}

/** Hides Task listing configuration, transport, and malformed upstream failures. */
function unavailableTaskListing(): Response {
  return problemResponse(
    503,
    'Task listing is unavailable',
    'task_listing_unavailable',
  );
}

/** Preserves Planning's tenant-indistinguishable parent absence without trusting its body. */
function missingTaskParent(): Response {
  return problemResponse(404, 'Project was not found', 'project_not_found');
}

/** Narrows unknown JSON to an ordinary object rather than an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Counts user-visible Unicode code points rather than UTF-16 code units. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** Reads one HTTP stream without exceeding the declared or actual byte budget. */
async function readBoundedText(
  response: Request | Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new Error('Message exceeds byte limit');
  }
  if (!response.body) throw new Error('Message body is unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytesRead = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel('Message exceeds byte limit');
        throw new Error('Message exceeds byte limit');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    try {
      await reader.cancel('Message is invalid');
    } catch {
      // Stream cancellation is best-effort after the boundary has failed closed.
    }
    throw new Error('Message is invalid');
  } finally {
    reader.releaseLock();
  }
  if (!body) throw new Error('Message body is unavailable');
  return body;
}

/** Parses bounded JSON while respecting case-insensitive JSON media types. */
async function readBoundedJson(
  response: Request | Response,
  maximumBytes: number,
): Promise<unknown> {
  const mediaType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    mediaType !== 'application/json' &&
    mediaType !== 'application/problem+json'
  ) {
    throw new Error('JSON media type is required');
  }
  try {
    return JSON.parse(await readBoundedText(response, maximumBytes)) as unknown;
  } catch {
    throw new Error('JSON body is invalid');
  }
}

/** Requires a bounded, trimmed, control-free user-visible Task title. */
function requireTaskTitle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Task title is invalid');
  const title = value.trim();
  if (
    !title ||
    title !== value ||
    /[\u0000-\u001f\u007f]/u.test(title) ||
    codePointLength(title) > MAXIMUM_TITLE_CHARACTERS ||
    Buffer.byteLength(title, 'utf8') > 1024
  ) {
    throw new Error('Task title is invalid');
  }
  return title;
}

/** Requires an opaque canonical UUIDv4 at every browser/upstream identity boundary. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error('Task identity is invalid');
  }
  return value.toLowerCase();
}

/** Requires RFC 3339 evidence and canonicalizes it to an equivalent UTC instant. */
function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    throw new Error('Task timestamp is invalid');
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('Task timestamp is invalid');
  return new Date(instant).toISOString();
}

/** Accepts exactly one Task title and no browser-selected ownership or state fields. */
async function parseBrowserTaskRequest(request: Request): Promise<string> {
  const value = await readBoundedJson(request, MAXIMUM_REQUEST_BYTES);
  if (!isPlainObject(value) || Object.keys(value).length !== 1) {
    throw new Error('Task request is invalid');
  }
  return requireTaskTitle(value.title);
}

/** Validates the exact first-party Task route and rejects query-shaped authority. */
function requireTaskRoute(
  request: Request,
  projectId: string,
  method: 'GET' | 'POST',
): void {
  const url = new URL(request.url);
  if (
    request.method !== method ||
    url.pathname !== `/api/planning/projects/${projectId}/tasks` ||
    url.search
  ) {
    throw new Error('Task route is invalid');
  }
}

/** Accepts a bounded cookie only for Identity session introspection. */
function requireCookieHeader(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? undefined;
  if (
    cookie !== undefined &&
    (Buffer.byteLength(cookie, 'utf8') > MAXIMUM_COOKIE_BYTES ||
      /[\r\n\u0000]/u.test(cookie))
  ) {
    throw new Error('Cookie header is invalid');
  }
  return cookie;
}

/** Builds an HTTP header set without serializing undefined values. */
function requestHeaders(entries: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/** Validates one Task and strips workspace authority before browser exposure. */
function parseTaskRecord(
  value: unknown,
  expectedWorkspaceId: string,
  expectedProjectId: string,
): PlanningTaskView {
  if (!isPlainObject(value)) throw new Error('Task response is invalid');
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 6 ||
    keys[0] !== 'createdAt' ||
    keys[1] !== 'id' ||
    keys[2] !== 'projectId' ||
    keys[3] !== 'status' ||
    keys[4] !== 'title' ||
    keys[5] !== 'workspaceId'
  ) {
    throw new Error('Task response is invalid');
  }
  const workspaceId = requireUuid(value.workspaceId);
  const projectId = requireUuid(value.projectId);
  if (workspaceId !== expectedWorkspaceId || projectId !== expectedProjectId) {
    throw new Error('Task response ownership is invalid');
  }
  if (value.status !== 'todo' && value.status !== 'done') {
    throw new Error('Task response status is invalid');
  }
  return Object.freeze({
    id: requireUuid(value.id),
    projectId,
    title: requireTaskTitle(value.title),
    status: value.status,
    createdAt: requireTimestamp(value.createdAt),
  });
}

/** Validates creation evidence against host-derived ownership, parent, title, and initial state. */
function parseCreatedTask(
  value: unknown,
  expectedWorkspaceId: string,
  expectedProjectId: string,
  expectedTitle: string,
): PlanningTaskView {
  const task = parseTaskRecord(value, expectedWorkspaceId, expectedProjectId);
  if (task.title !== expectedTitle || task.status !== 'todo') {
    throw new Error('Task creation evidence is invalid');
  }
  return task;
}

/** Validates a bounded identity-unique Task collection before browser exposure. */
function parseTaskCollection(
  value: unknown,
  expectedWorkspaceId: string,
  expectedProjectId: string,
): PlanningTaskView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_TASKS) {
    throw new Error('Task collection is invalid');
  }
  const tasks = value.map((task) =>
    parseTaskRecord(task, expectedWorkspaceId, expectedProjectId),
  );
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new Error('Task collection contains duplicate identities');
  }
  return tasks;
}

/**
 * Creates one durable Task below a route-bound Project. Browser credentials stop at
 * Identity; Planning receives only the server-derived workspace signature bound to
 * the exact method/path plus the validated title. Returned ownership and initial
 * state are verified before any Task evidence is released to the browser.
 */
export async function handlePlanningTaskCreateRequest(
  request: Request,
  projectId: string,
  environment: WebEnvironment,
  fetcher: PlanningTaskFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let safeProjectId: string;
  let title: string;
  let cookie: string | undefined;
  try {
    safeProjectId = requireUuid(projectId);
    requireTaskRoute(request, safeProjectId, 'POST');
    title = await parseBrowserTaskRequest(request);
    cookie = requireCookieHeader(request);
  } catch {
    return invalidTaskRequest();
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
    if (identityResponse.status !== 200) return unavailableTaskCreation();
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const planningPath = `/v1/projects/${safeProjectId}/tasks`;
    const contextHeaders = createPlanningContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
      { method: 'POST', path: planningPath },
    );
    const planningResponse = await fetcher(new URL(planningPath, planningOrigin), {
      method: 'POST',
      headers: requestHeaders({
        ...contextHeaders,
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      }),
      body: JSON.stringify({ title }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (planningResponse.status === 400) return invalidTaskRequest();
    if (planningResponse.status === 404) return missingTaskParent();
    if (planningResponse.status !== 201) return unavailableTaskCreation();
    const task = parseCreatedTask(
      await readBoundedJson(planningResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
      safeProjectId,
      title,
    );
    return Response.json(task, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableTaskCreation();
  }
}

/**
 * Lists durable Tasks below one route-bound Project using only server-derived
 * workspace authority. Every upstream record must match that workspace and parent
 * before workspace identity is stripped from the browser-safe response.
 */
export async function handlePlanningTaskListRequest(
  request: Request,
  projectId: string,
  environment: WebEnvironment,
  fetcher: PlanningTaskFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let safeProjectId: string;
  let cookie: string | undefined;
  try {
    safeProjectId = requireUuid(projectId);
    requireTaskRoute(request, safeProjectId, 'GET');
    cookie = requireCookieHeader(request);
  } catch {
    return invalidTaskRequest();
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
    if (identityResponse.status !== 200) return unavailableTaskListing();
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const planningPath = `/v1/projects/${safeProjectId}/tasks`;
    const contextHeaders = createPlanningContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
      { method: 'GET', path: planningPath },
    );
    const planningResponse = await fetcher(new URL(planningPath, planningOrigin), {
      method: 'GET',
      headers: requestHeaders({
        ...contextHeaders,
        'x-correlation-id': correlationId,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (planningResponse.status === 404) return missingTaskParent();
    if (planningResponse.status !== 200) return unavailableTaskListing();
    const tasks = parseTaskCollection(
      await readBoundedJson(planningResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
      safeProjectId,
    );
    return Response.json(tasks, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableTaskListing();
  }
}
