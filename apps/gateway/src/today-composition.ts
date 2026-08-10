import { createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_TODAY_ACTIONS = 50;
const MAXIMUM_TODAY_HABITS = 100;
const MAXIMUM_HABIT_TITLE_BYTES = 512;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const UPSTREAM_TIMEOUT_MS = 3_000;

/** Environment values used by the bounded Gateway composition path. */
export interface GatewayTodayEnvironment {
  readonly IDENTITY_SERVICE_ORIGIN?: string;
  readonly PLANNING_SERVICE_ORIGIN?: string;
  readonly PLANNING_GATEWAY_CONTEXT_SECRET?: string;
  readonly HABIT_SERVICE_ORIGIN?: string;
  readonly HABIT_GATEWAY_CONTEXT_SECRET?: string;
}

/** Minimal fetch surface used by production composition and deterministic tests. */
export type GatewayTodayFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Validated Planning action evidence with an opaque product identifier. */
export interface GatewayPlanningTodayAction {
  readonly id: string;
  readonly [key: string]: unknown;
}

/** Validated Planning-owned Today aggregate carried without cross-service persistence reads. */
export interface GatewayPlanningToday {
  readonly version: 'life-os.today.v1';
  readonly aggregateId: string;
  readonly revision: string;
  readonly date: string;
  readonly actions: readonly GatewayPlanningTodayAction[];
}

/** Validated Habit-owned scheduled/completion evidence. */
export interface GatewayHabitTodayStatus {
  readonly habitId: string;
  readonly title: string;
  readonly scheduledLocalDate: string;
  readonly completed: boolean;
  readonly completionId?: string;
}

/** Planning-only compatibility response retained while callers migrate to full composition. */
export interface GatewayPlanningTodayView {
  readonly version: 'life-os.gateway-today.v1';
  readonly date: string;
  readonly planning: GatewayPlanningToday;
  readonly degraded: readonly ['habits_not_composed'];
}

export type GatewayTodayDegradation =
  | 'habits_not_configured'
  | 'habits_unavailable';

/** Buyer-visible Gateway Today response composed only from validated service evidence. */
export interface GatewayTodayView {
  readonly version: 'life-os.gateway-today.v1';
  readonly date: string;
  readonly planning: GatewayPlanningToday;
  readonly habits: readonly GatewayHabitTodayStatus[];
  readonly degraded: readonly GatewayTodayDegradation[];
}

interface PlanningComposition {
  readonly date: string;
  readonly workspaceId: string;
  readonly planning: GatewayPlanningToday;
  readonly correlationId: string;
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

/** Releases an unread upstream response body before the connection is reused. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Upstream body disposal is best-effort on an already failing path.
  }
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
  if (contentType !== 'application/json') throw unavailable();
  try {
    return JSON.parse(await readBoundedText(response)) as unknown;
  } catch (error) {
    if (error instanceof GatewayTodayError) throw error;
    throw unavailable();
  }
}

/** Validates the minimum action identity contract before forwarding Planning evidence. */
function requirePlanningAction(value: unknown): GatewayPlanningTodayAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unavailable();
  }
  const action = value as Record<string, unknown>;
  if (typeof action.id !== 'string' || !UUID_V4_PATTERN.test(action.id)) {
    throw unavailable();
  }
  return Object.freeze({ ...action, id: action.id.toLowerCase() });
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
  const actions = record.actions.map(requirePlanningAction);
  return Object.freeze({
    version: 'life-os.today.v1',
    aggregateId: record.aggregateId.toLowerCase(),
    revision: record.revision.toLowerCase(),
    date: expectedDate,
    actions: Object.freeze(actions),
  });
}

function requireHabitTodayItem(
  value: unknown,
  expectedDate: string,
): GatewayHabitTodayStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw unavailable();
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = record.completed === true
    ? ['habitId', 'title', 'scheduledLocalDate', 'completed', 'completionId']
    : ['habitId', 'title', 'scheduledLocalDate', 'completed'];
  if (
    Object.keys(record).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(record, key)) ||
    typeof record.habitId !== 'string' ||
    !UUID_V4_PATTERN.test(record.habitId) ||
    typeof record.title !== 'string' ||
    !record.title.trim() ||
    Buffer.byteLength(record.title, 'utf8') > MAXIMUM_HABIT_TITLE_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(record.title) ||
    record.scheduledLocalDate !== expectedDate ||
    typeof record.completed !== 'boolean' ||
    (record.completed === true &&
      (typeof record.completionId !== 'string' ||
        !UUID_V4_PATTERN.test(record.completionId))) ||
    (record.completed === false && Object.hasOwn(record, 'completionId'))
  ) {
    throw unavailable();
  }
  return Object.freeze(
    record.completed
      ? {
          habitId: record.habitId.toLowerCase(),
          title: record.title,
          scheduledLocalDate: expectedDate,
          completed: true,
          completionId: (record.completionId as string).toLowerCase(),
        }
      : {
          habitId: record.habitId.toLowerCase(),
          title: record.title,
          scheduledLocalDate: expectedDate,
          completed: false,
        },
  );
}

function requireHabitToday(
  value: unknown,
  expectedDate: string,
): readonly GatewayHabitTodayStatus[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_TODAY_HABITS) {
    throw unavailable();
  }
  return Object.freeze(
    value.map((item) => requireHabitTodayItem(item, expectedDate)),
  );
}

function workspaceContextHeaders(
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

async function composePlanning(
  cookie: string | undefined,
  date: string,
  environment: GatewayTodayEnvironment,
  fetcher: GatewayTodayFetch,
  nowSeconds: number,
): Promise<PlanningComposition> {
  const safeDate = requireDate(date);
  const safeCookie = requireCookie(cookie);
  const identityOrigin = requireServiceOrigin(
    environment.IDENTITY_SERVICE_ORIGIN,
  );
  const planningOrigin = requireServiceOrigin(
    environment.PLANNING_SERVICE_ORIGIN,
  );
  const planningSecret = requireGatewaySecret(
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
    await discardBody(identityResponse);
    throw new GatewayTodayError(
      401,
      'authentication_required',
      'Authentication is required',
    );
  }
  if (identityResponse.status !== 200) {
    await discardBody(identityResponse);
    throw unavailable();
  }
  const workspaceId = requireWorkspaceId(await readBoundedJson(identityResponse));

  let planningResponse: Response;
  try {
    planningResponse = await fetcher(
      new URL(`/v1/today/${safeDate}`, planningOrigin),
      {
        method: 'GET',
        headers: serviceHeaders({
          ...workspaceContextHeaders(workspaceId, planningSecret, nowSeconds),
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
    await discardBody(planningResponse);
    throw new GatewayTodayError(
      404,
      'today_not_found',
      'Today aggregate was not found',
    );
  }
  if (planningResponse.status !== 200) {
    await discardBody(planningResponse);
    throw unavailable();
  }
  const planning = requirePlanningToday(
    await readBoundedJson(planningResponse),
    safeDate,
  );
  return Object.freeze({
    date: safeDate,
    workspaceId,
    planning,
    correlationId,
  });
}

/**
 * Authenticates through Identity and returns the protected Planning slice only.
 * This compatibility entry point intentionally preserves its legacy degraded marker.
 */
export async function composePlanningToday(
  cookie: string | undefined,
  date: string,
  environment: GatewayTodayEnvironment,
  fetcher: GatewayTodayFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<GatewayPlanningTodayView> {
  const composed = await composePlanning(
    cookie,
    date,
    environment,
    fetcher,
    nowSeconds,
  );
  return Object.freeze({
    version: 'life-os.gateway-today.v1',
    date: composed.date,
    planning: composed.planning,
    degraded: Object.freeze(['habits_not_composed'] as const),
  });
}

/**
 * Composes authenticated Planning and optional Habit Today evidence without
 * forwarding browser credentials or reading another service's persistence.
 */
export async function composeToday(
  cookie: string | undefined,
  date: string,
  environment: GatewayTodayEnvironment,
  fetcher: GatewayTodayFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<GatewayTodayView> {
  const composed = await composePlanning(
    cookie,
    date,
    environment,
    fetcher,
    nowSeconds,
  );
  const habitOriginValue = environment.HABIT_SERVICE_ORIGIN;
  const habitSecretValue = environment.HABIT_GATEWAY_CONTEXT_SECRET;
  if (!habitOriginValue && !habitSecretValue) {
    return Object.freeze({
      version: 'life-os.gateway-today.v1',
      date: composed.date,
      planning: composed.planning,
      habits: Object.freeze([]),
      degraded: Object.freeze(['habits_not_configured'] as const),
    });
  }

  let habitOrigin: string;
  let habitSecret: string;
  try {
    habitOrigin = requireServiceOrigin(habitOriginValue);
    habitSecret = requireGatewaySecret(habitSecretValue);
  } catch {
    return Object.freeze({
      version: 'life-os.gateway-today.v1',
      date: composed.date,
      planning: composed.planning,
      habits: Object.freeze([]),
      degraded: Object.freeze(['habits_unavailable'] as const),
    });
  }

  let habitResponse: Response;
  try {
    const habitUrl = new URL('/v1/habits/today', habitOrigin);
    habitUrl.searchParams.set('date', composed.date);
    habitResponse = await fetcher(habitUrl, {
      method: 'GET',
      headers: serviceHeaders({
        ...workspaceContextHeaders(
          composed.workspaceId,
          habitSecret,
          nowSeconds,
        ),
        'x-correlation-id': composed.correlationId,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return Object.freeze({
      version: 'life-os.gateway-today.v1',
      date: composed.date,
      planning: composed.planning,
      habits: Object.freeze([]),
      degraded: Object.freeze(['habits_unavailable'] as const),
    });
  }
  if (habitResponse.status !== 200) {
    await discardBody(habitResponse);
    return Object.freeze({
      version: 'life-os.gateway-today.v1',
      date: composed.date,
      planning: composed.planning,
      habits: Object.freeze([]),
      degraded: Object.freeze(['habits_unavailable'] as const),
    });
  }

  try {
    const habits = requireHabitToday(
      await readBoundedJson(habitResponse),
      composed.date,
    );
    return Object.freeze({
      version: 'life-os.gateway-today.v1',
      date: composed.date,
      planning: composed.planning,
      habits,
      degraded: Object.freeze([]),
    });
  } catch {
    return Object.freeze({
      version: 'life-os.gateway-today.v1',
      date: composed.date,
      planning: composed.planning,
      habits: Object.freeze([]),
      degraded: Object.freeze(['habits_unavailable'] as const),
    });
  }
}
