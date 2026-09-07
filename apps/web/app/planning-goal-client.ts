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
const MAXIMUM_GOALS = 100;
const UPSTREAM_TIMEOUT_MS = 3_000;

/** Browser-safe projection of one durable Planning goal. */
export interface PlanningGoalView {
  id: string;
  title: string;
  createdAt: string;
}

/** Minimal fetch dependency used by the production boundary and deterministic tests. */
export type PlanningGoalFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type WebEnvironment = Readonly<Record<string, string | undefined>>;

/** Returns one no-store RFC 9457-style browser problem without dependency details. */
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

/** Rejects malformed browser input without consulting identity or Planning. */
function invalidGoalRequest(): Response {
  return problemResponse(
    400,
    'Goal request is invalid',
    'invalid_goal_request',
  );
}

/** Hides creation configuration, network, and malformed dependency failures. */
function unavailableGoalCreation(): Response {
  return problemResponse(
    503,
    'Goal creation is unavailable',
    'goal_creation_unavailable',
  );
}

/** Hides listing configuration, network, and malformed dependency failures. */
function unavailableGoalListing(): Response {
  return problemResponse(
    503,
    'Goal listing is unavailable',
    'goal_listing_unavailable',
  );
}

/** Narrows unknown JSON to an ordinary object rather than an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Counts user-visible Unicode code points rather than UTF-16 code units. */
function codePointLength(value: string): number {
  return [...value].length;
}

/** Reads a stream without allowing declared or actual bytes to exceed its budget. */
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
  if (!response.body) {
    throw new Error('Message body is unavailable');
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
      if (byteLength > maximumBytes) {
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
      // Stream cancellation is best-effort after the boundary has already failed closed.
    }
    throw new Error('Message is invalid');
  } finally {
    reader.releaseLock();
  }
  if (!body) {
    throw new Error('Message body is unavailable');
  }
  return body;
}

/** Reads bounded JSON while preserving HTTP's case-insensitive media-type semantics. */
async function readBoundedJson(
  response: Request | Response,
  maximumBytes: number,
): Promise<unknown> {
  const contentType = response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== 'application/json' &&
    contentType !== 'application/problem+json'
  ) {
    throw new Error('JSON media type is required');
  }
  const body = await readBoundedText(response, maximumBytes);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('JSON body is invalid');
  }
}

/** Requires a bounded, trimmed, control-free Goal title. */
function requireGoalTitle(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Goal title is invalid');
  }
  const title = value.trim();
  if (
    !title ||
    value !== title ||
    /[\u0000-\u001f\u007f]/u.test(title) ||
    codePointLength(title) > MAXIMUM_TITLE_CHARACTERS ||
    Buffer.byteLength(title, 'utf8') > 1024
  ) {
    throw new Error('Goal title is invalid');
  }
  return title;
}

/** Accepts exactly one bounded title and no browser-selected authority fields. */
async function parseBrowserGoalRequest(request: Request): Promise<string> {
  const value = await readBoundedJson(request, MAXIMUM_REQUEST_BYTES);
  if (!isPlainObject(value) || Object.keys(value).length !== 1) {
    throw new Error('Goal request is invalid');
  }
  return requireGoalTitle(value.title);
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

/** Builds headers without introducing undefined values into the HTTP request. */
function requestHeaders(entries: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/** Requires one canonical UUIDv4 from untrusted Planning response evidence. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error('Goal response is invalid');
  }
  return value.toLowerCase();
}

/** Requires a valid RFC 3339 timestamp and emits one canonical UTC instant. */
function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    throw new Error('Goal response is invalid');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('Goal response is invalid');
  }
  return new Date(parsed).toISOString();
}

/** Validates one exact Goal record and strips workspace authority from browser output. */
function parseGoalRecord(
  value: unknown,
  expectedWorkspaceId: string,
): PlanningGoalView {
  if (!isPlainObject(value)) {
    throw new Error('Goal response is invalid');
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== 'createdAt' ||
    keys[1] !== 'id' ||
    keys[2] !== 'title' ||
    keys[3] !== 'workspaceId'
  ) {
    throw new Error('Goal response is invalid');
  }
  const workspaceId = requireUuid(value.workspaceId);
  if (workspaceId !== expectedWorkspaceId) {
    throw new Error('Goal response ownership is invalid');
  }
  return Object.freeze({
    id: requireUuid(value.id),
    title: requireGoalTitle(value.title),
    createdAt: requireTimestamp(value.createdAt),
  });
}

/** Validates create evidence against both host-derived ownership and submitted title. */
function parseCreatedGoal(
  value: unknown,
  expectedWorkspaceId: string,
  expectedTitle: string,
): PlanningGoalView {
  const goal = parseGoalRecord(value, expectedWorkspaceId);
  if (goal.title !== expectedTitle) {
    throw new Error('Goal response title is invalid');
  }
  return goal;
}

/** Validates a bounded Goal collection before any record reaches the browser. */
function parseGoalCollection(
  value: unknown,
  expectedWorkspaceId: string,
): PlanningGoalView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_GOALS) {
    throw new Error('Goal collection is invalid');
  }
  const goals = value.map((goal) => parseGoalRecord(goal, expectedWorkspaceId));
  const goalIds = new Set(goals.map((goal) => goal.id));
  if (goalIds.size !== goals.length) {
    throw new Error('Goal collection contains duplicate identities');
  }
  return goals;
}

/**
 * Creates one durable Goal through the authenticated first-party web boundary.
 * Browser cookies terminate at Identity. Planning receives only a short-lived,
 * method/path-bound workspace signature plus the bounded Goal title, and returned
 * ownership evidence must match the server-derived session before the browser sees it.
 */
export async function handlePlanningGoalCreateRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: PlanningGoalFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let title: string;
  let cookie: string | undefined;
  try {
    title = await parseBrowserGoalRequest(request);
    cookie = requireCookieHeader(request);
  } catch {
    return invalidGoalRequest();
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
    if (identityResponse.status !== 200) {
      return unavailableGoalCreation();
    }
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const contextHeaders = createPlanningContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
      { method: 'POST', path: '/v1/goals' },
    );

    const planningResponse = await fetcher(
      new URL('/v1/goals', planningOrigin),
      {
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
      },
    );
    if (planningResponse.status === 400) {
      return invalidGoalRequest();
    }
    if (planningResponse.status !== 201) {
      return unavailableGoalCreation();
    }
    const goal = parseCreatedGoal(
      await readBoundedJson(planningResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
      title,
    );
    return Response.json(goal, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableGoalCreation();
  }
}

/**
 * Lists durable Goals through the authenticated first-party web boundary. The
 * browser cookie is used only for Identity introspection; Planning sees an exact
 * GET-bound workspace signature, and every returned record is checked against the
 * server-derived workspace before the authority field is removed from browser output.
 */
export async function handlePlanningGoalListRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: PlanningGoalFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let cookie: string | undefined;
  try {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.search) {
      return invalidGoalRequest();
    }
    cookie = requireCookieHeader(request);
  } catch {
    return invalidGoalRequest();
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
    if (identityResponse.status !== 200) {
      return unavailableGoalListing();
    }
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const contextHeaders = createPlanningContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
      { method: 'GET', path: '/v1/goals' },
    );

    const planningResponse = await fetcher(
      new URL('/v1/goals', planningOrigin),
      {
        method: 'GET',
        headers: requestHeaders({
          ...contextHeaders,
          'x-correlation-id': correlationId,
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (planningResponse.status !== 200) {
      return unavailableGoalListing();
    }
    const goals = parseGoalCollection(
      await readBoundedJson(planningResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
    );
    return Response.json(goals, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableGoalListing();
  }
}

const MAXIMUM_PROJECTS = 100;

/** Browser-safe projection of one durable Project below a Goal. */
export interface PlanningProjectView {
  id: string;
  goalId: string;
  title: string;
  createdAt: string;
}

/** Rejects malformed Project requests without consulting Identity or Planning. */
function invalidProjectRequest(): Response {
  return problemResponse(
    400,
    'Project request is invalid',
    'invalid_project_request',
  );
}

/** Hides Project creation configuration, network, and malformed dependency failures. */
function unavailableProjectCreation(): Response {
  return problemResponse(
    503,
    'Project creation is unavailable',
    'project_creation_unavailable',
  );
}

/** Preserves Planning's tenant-indistinguishable parent absence without trusting its body. */
function missingProjectParent(): Response {
  return problemResponse(404, 'Goal was not found', 'goal_not_found');
}

/** Hides Project listing configuration, network, and malformed dependency failures. */
function unavailableProjectListing(): Response {
  return problemResponse(
    503,
    'Project listing is unavailable',
    'project_listing_unavailable',
  );
}

/** Requires the exact first-party Project route and forbids query-shaped authority. */
function requireProjectRoute(
  request: Request,
  goalId: string,
  method: 'GET' | 'POST',
): void {
  const url = new URL(request.url);
  if (
    request.method !== method ||
    url.pathname !== `/api/planning/goals/${goalId}/projects` ||
    url.search
  ) {
    throw new Error('Project route is invalid');
  }
}

/** Accepts exactly one bounded Project title and no browser-selected ownership fields. */
async function parseBrowserProjectRequest(request: Request): Promise<string> {
  const value = await readBoundedJson(request, MAXIMUM_REQUEST_BYTES);
  if (!isPlainObject(value) || Object.keys(value).length !== 1) {
    throw new Error('Project request is invalid');
  }
  return requireGoalTitle(value.title);
}

/** Validates one exact Project record against server-derived workspace and parent scope. */
function parseProjectRecord(
  value: unknown,
  expectedWorkspaceId: string,
  expectedGoalId: string,
): PlanningProjectView {
  if (!isPlainObject(value)) {
    throw new Error('Project response is invalid');
  }
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 5 ||
    keys[0] !== 'createdAt' ||
    keys[1] !== 'goalId' ||
    keys[2] !== 'id' ||
    keys[3] !== 'title' ||
    keys[4] !== 'workspaceId'
  ) {
    throw new Error('Project response is invalid');
  }
  const workspaceId = requireUuid(value.workspaceId);
  const goalId = requireUuid(value.goalId);
  if (workspaceId !== expectedWorkspaceId || goalId !== expectedGoalId) {
    throw new Error('Project response ownership is invalid');
  }
  return Object.freeze({
    id: requireUuid(value.id),
    goalId,
    title: requireGoalTitle(value.title),
    createdAt: requireTimestamp(value.createdAt),
  });
}

/** Validates Project creation evidence against ownership, parent, and submitted title. */
function parseCreatedProject(
  value: unknown,
  expectedWorkspaceId: string,
  expectedGoalId: string,
  expectedTitle: string,
): PlanningProjectView {
  const project = parseProjectRecord(
    value,
    expectedWorkspaceId,
    expectedGoalId,
  );
  if (project.title !== expectedTitle) {
    throw new Error('Project response title is invalid');
  }
  return project;
}

/** Validates one bounded, identity-unique Project collection before browser exposure. */
function parseProjectCollection(
  value: unknown,
  expectedWorkspaceId: string,
  expectedGoalId: string,
): PlanningProjectView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_PROJECTS) {
    throw new Error('Project collection is invalid');
  }
  const projects = value.map((project) =>
    parseProjectRecord(project, expectedWorkspaceId, expectedGoalId),
  );
  const projectIds = new Set(projects.map((project) => project.id));
  if (projectIds.size !== projects.length) {
    throw new Error('Project collection contains duplicate identities');
  }
  return projects;
}

/**
 * Creates one durable Project through the authenticated first-party boundary.
 * The parent Goal identifier is route-bound and validated as UUIDv4 before any
 * dependency call; browser cookies terminate at Identity, while Planning receives
 * only the exact method/path-bound workspace signature and bounded title.
 */
export async function handlePlanningProjectCreateRequest(
  request: Request,
  goalId: string,
  environment: WebEnvironment,
  fetcher: PlanningGoalFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let safeGoalId: string;
  let title: string;
  let cookie: string | undefined;
  try {
    safeGoalId = requireUuid(goalId);
    requireProjectRoute(request, safeGoalId, 'POST');
    title = await parseBrowserProjectRequest(request);
    cookie = requireCookieHeader(request);
  } catch {
    return invalidProjectRequest();
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
    if (identityResponse.status !== 200) {
      return unavailableProjectCreation();
    }
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const planningPath = `/v1/goals/${safeGoalId}/projects`;
    const contextHeaders = createPlanningContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
      { method: 'POST', path: planningPath },
    );
    const planningResponse = await fetcher(
      new URL(planningPath, planningOrigin),
      {
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
      },
    );
    if (planningResponse.status === 400) {
      return invalidProjectRequest();
    }
    if (planningResponse.status === 404) {
      return missingProjectParent();
    }
    if (planningResponse.status !== 201) {
      return unavailableProjectCreation();
    }
    const project = parseCreatedProject(
      await readBoundedJson(planningResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
      safeGoalId,
      title,
    );
    return Response.json(project, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableProjectCreation();
  }
}

/**
 * Lists durable Projects below one authenticated Goal without exposing workspace
 * authority. The exact parent Goal is bound into the Planning signature, and every
 * returned record must match both the server-derived workspace and requested parent.
 */
export async function handlePlanningProjectListRequest(
  request: Request,
  goalId: string,
  environment: WebEnvironment,
  fetcher: PlanningGoalFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let safeGoalId: string;
  let cookie: string | undefined;
  try {
    safeGoalId = requireUuid(goalId);
    requireProjectRoute(request, safeGoalId, 'GET');
    cookie = requireCookieHeader(request);
  } catch {
    return invalidProjectRequest();
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
    if (identityResponse.status !== 200) {
      return unavailableProjectListing();
    }
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const planningPath = `/v1/goals/${safeGoalId}/projects`;
    const contextHeaders = createPlanningContextHeaders(
      workspaceId,
      contextSecret,
      nowSeconds,
      { method: 'GET', path: planningPath },
    );
    const planningResponse = await fetcher(
      new URL(planningPath, planningOrigin),
      {
        method: 'GET',
        headers: requestHeaders({
          ...contextHeaders,
          'x-correlation-id': correlationId,
        }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    if (planningResponse.status !== 200) {
      return unavailableProjectListing();
    }
    const projects = parseProjectCollection(
      await readBoundedJson(planningResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
      safeGoalId,
    );
    return Response.json(projects, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableProjectListing();
  }
}
