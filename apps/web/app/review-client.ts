import { createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_REQUEST_BYTES = 16 * 1024;
const MAXIMUM_RESPONSE_BYTES = 128 * 1024;
const MAXIMUM_REFLECTION_CHARACTERS = 2_000;
const MAXIMUM_HISTORY_RECORDS = 100;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const UPSTREAM_TIMEOUT_MS = 3_000;

type WebEnvironment = Readonly<Record<string, string | undefined>>;

export type ReviewRitualKind =
  | 'daily-planning'
  | 'daily-shutdown'
  | 'weekly-review';

/** Browser-safe immutable projection of one completed review ritual. */
export interface ReviewCompletionView {
  id: string;
  ritualKind: ReviewRitualKind;
  periodStartDate: string;
  completedStepCount: number;
  totalStepCount: number;
  plannedItemCount: number;
  completedItemCount: number;
  habitCompletionCount: number;
  reflection?: string;
  completedAt: string;
  recordedAt: string;
}

/** Minimal fetch dependency used by Review BFF handlers and deterministic tests. */
export type ReviewFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface WeeklyReviewCompletionInput {
  periodStartDate: string;
  idempotencyKey: string;
  completedStepCount: number;
  totalStepCount: number;
  plannedItemCount: number;
  completedItemCount: number;
  habitCompletionCount: number;
  reflection?: string;
  completedAt: string;
}

interface ParsedReviewRecord {
  view: ReviewCompletionView;
  workspaceId: string;
  idempotencyKey: string;
  payloadDigest: string;
}

/** Returns one bounded no-store browser problem without upstream details. */
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

/** Rejects malformed browser Review requests before dependency access. */
function invalidReviewRequest(): Response {
  return problemResponse(
    400,
    'Review request is invalid',
    'invalid_review_request',
  );
}

/** Reconstructs the only browser-visible immutable-review conflict. */
function reviewCompletionConflict(): Response {
  return problemResponse(
    409,
    'Weekly Review completion conflicts with existing evidence',
    'review_completion_conflict',
  );
}

/** Hides Review configuration, transport, persistence, and malformed evidence failures. */
function unavailableReviewCompletion(): Response {
  return problemResponse(
    503,
    'Weekly Review completion is unavailable',
    'review_completion_unavailable',
  );
}

/** Hides Review history configuration, transport, and malformed evidence failures. */
function unavailableReviewHistory(): Response {
  return problemResponse(
    503,
    'Review history is unavailable',
    'review_history_unavailable',
  );
}

/** Narrows unknown JSON to one non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Rejects unknown fields and requires every non-optional field. */
function requireObjectKeys(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('Review evidence shape is invalid');
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error('Review evidence shape is invalid');
    }
  }
}

/** Reads one HTTP body without exceeding its declared or actual byte budget. */
async function readBoundedText(
  message: Request | Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = message.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new Error('Review message exceeds byte limit');
  }
  if (!message.body) {
    throw new Error('Review message body is unavailable');
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
        await reader.cancel('Review message exceeds byte limit');
        throw new Error('Review message exceeds byte limit');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch {
    try {
      await reader.cancel('Review message is invalid');
    } catch {
      // Cancellation is best-effort after the boundary has already failed closed.
    }
    throw new Error('Review message is invalid');
  } finally {
    reader.releaseLock();
  }
  if (!body) {
    throw new Error('Review message body is unavailable');
  }
  return body;
}

/** Reads bounded JSON and accepts only JSON problem or ordinary JSON media types. */
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
    throw new Error('Review JSON media type is required');
  }
  try {
    return JSON.parse(await readBoundedText(message, maximumBytes)) as unknown;
  } catch {
    throw new Error('Review JSON body is invalid');
  }
}

/** Requires one canonical opaque UUIDv4 identifier. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error('Review identifier is invalid');
  }
  return value.toLowerCase();
}

/** Requires one real Gregorian date and optional Monday anchoring. */
function requireLocalDate(value: unknown, requireMonday = false): string {
  if (typeof value !== 'string') {
    throw new Error('Review local date is invalid');
  }
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new Error('Review local date is invalid');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    (requireMonday && date.getUTCDay() !== 1)
  ) {
    throw new Error('Review local date is invalid');
  }
  return value;
}

/** Requires one canonical UTC instant identical to Date#toISOString output. */
function requireInstant(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Review instant is invalid');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error('Review instant is invalid');
  }
  return value;
}

/** Requires one bounded non-negative integer. */
function requireCount(value: unknown, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new Error('Review count is invalid');
  }
  return value;
}

/** Preserves optional reflection text only when already canonical and bounded. */
function requireReflection(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    [...value].length > MAXIMUM_REFLECTION_CHARACTERS ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw new Error('Review reflection is invalid');
  }
  return value;
}

/** Requires one supported Review ritual kind. */
function requireRitualKind(value: unknown): ReviewRitualKind {
  if (
    value !== 'daily-planning' &&
    value !== 'daily-shutdown' &&
    value !== 'weekly-review'
  ) {
    throw new Error('Review ritual kind is invalid');
  }
  return value;
}

/** Requires canonical SHA-256 evidence even though it is not exposed to browsers. */
function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
    throw new Error('Review digest is invalid');
  }
  return value;
}

/** Requires one fixed service origin without credentials or URL-path authority. */
function requireServiceOrigin(value: string | undefined): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('Review service origin is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Review service origin is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Review service origin is invalid');
  }
  return parsed.origin;
}

/** Requires the server-only HMAC key shared with the Review trusted-context verifier. */
function requireGatewaySecret(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES ||
    Buffer.byteLength(value, 'utf8') > 4096 ||
    /[\r\n\u0000]/u.test(value)
  ) {
    throw new Error('Review gateway context secret is invalid');
  }
  return value;
}

/** Extracts only server-derived workspace authority from Identity session evidence. */
function parseSessionWorkspace(value: unknown): string {
  if (!isPlainObject(value)) {
    throw new Error('Identity session response is invalid');
  }
  return requireUuid(value.workspaceId);
}

/** Accepts one bounded browser cookie only for Identity session introspection. */
function requireCookieHeader(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? undefined;
  if (
    cookie !== undefined &&
    (Buffer.byteLength(cookie, 'utf8') > MAXIMUM_COOKIE_BYTES ||
      /[\r\n\u0000]/u.test(cookie))
  ) {
    throw new Error('Review cookie header is invalid');
  }
  return cookie;
}

/** Builds trusted server-side headers without serializing undefined values. */
function requestHeaders(entries: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/** Signs Review workspace context over the exact trusted method and path. */
function createReviewContextHeaders(
  workspaceId: string,
  secret: string,
  nowSeconds: number,
  method: 'GET' | 'POST',
  path: string,
): Readonly<Record<string, string>> {
  const safeWorkspaceId = requireUuid(workspaceId);
  const safeSecret = requireGatewaySecret(secret);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('Review gateway context timestamp is invalid');
  }
  const issuedAt = String(nowSeconds);
  const signature = createHmac('sha256', safeSecret)
    .update(
      `life-os.review-context.v1\n${safeWorkspaceId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
  return Object.freeze({
    'x-life-os-workspace-id': safeWorkspaceId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  });
}

/** Parses the weekly-review browser command without accepting tenant or digest authority. */
async function parseWeeklyReviewRequest(
  request: Request,
): Promise<WeeklyReviewCompletionInput> {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.search) {
    throw new Error('Review request is invalid');
  }
  const value = await readBoundedJson(request, MAXIMUM_REQUEST_BYTES);
  if (!isPlainObject(value)) {
    throw new Error('Review request is invalid');
  }
  requireObjectKeys(
    value,
    [
      'periodStartDate',
      'idempotencyKey',
      'completedStepCount',
      'totalStepCount',
      'plannedItemCount',
      'completedItemCount',
      'habitCompletionCount',
      'completedAt',
    ],
    ['reflection'],
  );

  const completedStepCount = requireCount(value.completedStepCount, 64);
  const totalStepCount = requireCount(value.totalStepCount, 64);
  const plannedItemCount = requireCount(value.plannedItemCount, 10_000);
  const completedItemCount = requireCount(value.completedItemCount, 10_000);
  const habitCompletionCount = requireCount(value.habitCompletionCount, 10_000);
  if (
    totalStepCount < 1 ||
    completedStepCount !== totalStepCount ||
    completedItemCount > plannedItemCount
  ) {
    throw new Error('Review completion counts are invalid');
  }

  return Object.freeze({
    periodStartDate: requireLocalDate(value.periodStartDate, true),
    idempotencyKey: requireUuid(value.idempotencyKey),
    completedStepCount,
    totalStepCount,
    plannedItemCount,
    completedItemCount,
    habitCompletionCount,
    reflection: requireReflection(value.reflection),
    completedAt: requireInstant(value.completedAt),
  });
}

/** Parses one immutable Review record and strips no evidence until ownership is verified. */
function parseReviewRecord(
  value: unknown,
  expectedWorkspaceId: string,
): ParsedReviewRecord {
  if (!isPlainObject(value)) {
    throw new Error('Review response is invalid');
  }
  requireObjectKeys(
    value,
    [
      'id',
      'workspaceId',
      'ritualKind',
      'periodStartDate',
      'idempotencyKey',
      'completedStepCount',
      'totalStepCount',
      'plannedItemCount',
      'completedItemCount',
      'habitCompletionCount',
      'completedAt',
      'payloadDigest',
      'recordedAt',
    ],
    ['reflection'],
  );
  const workspaceId = requireUuid(value.workspaceId);
  if (workspaceId !== expectedWorkspaceId) {
    throw new Error('Review response ownership is invalid');
  }
  const ritualKind = requireRitualKind(value.ritualKind);
  const completedStepCount = requireCount(value.completedStepCount, 64);
  const totalStepCount = requireCount(value.totalStepCount, 64);
  const plannedItemCount = requireCount(value.plannedItemCount, 10_000);
  const completedItemCount = requireCount(value.completedItemCount, 10_000);
  const habitCompletionCount = requireCount(value.habitCompletionCount, 10_000);
  if (
    totalStepCount < 1 ||
    completedStepCount !== totalStepCount ||
    completedItemCount > plannedItemCount
  ) {
    throw new Error('Review response counts are invalid');
  }
  const reflection = requireReflection(value.reflection);
  const view = Object.freeze({
    id: requireUuid(value.id),
    ritualKind,
    periodStartDate: requireLocalDate(
      value.periodStartDate,
      ritualKind === 'weekly-review',
    ),
    completedStepCount,
    totalStepCount,
    plannedItemCount,
    completedItemCount,
    habitCompletionCount,
    ...(reflection === undefined ? {} : { reflection }),
    completedAt: requireInstant(value.completedAt),
    recordedAt: requireInstant(value.recordedAt),
  });
  return Object.freeze({
    view,
    workspaceId,
    idempotencyKey: requireUuid(value.idempotencyKey),
    payloadDigest: requireDigest(value.payloadDigest),
  });
}

/** Requires creation evidence to describe exactly the accepted browser command. */
function parseCreatedWeeklyReview(
  value: unknown,
  expectedWorkspaceId: string,
  expected: WeeklyReviewCompletionInput,
): ReviewCompletionView {
  const record = parseReviewRecord(value, expectedWorkspaceId);
  if (
    record.view.ritualKind !== 'weekly-review' ||
    record.view.periodStartDate !== expected.periodStartDate ||
    record.idempotencyKey !== expected.idempotencyKey ||
    record.view.completedStepCount !== expected.completedStepCount ||
    record.view.totalStepCount !== expected.totalStepCount ||
    record.view.plannedItemCount !== expected.plannedItemCount ||
    record.view.completedItemCount !== expected.completedItemCount ||
    record.view.habitCompletionCount !== expected.habitCompletionCount ||
    record.view.reflection !== expected.reflection ||
    record.view.completedAt !== expected.completedAt
  ) {
    throw new Error('Review create evidence disagrees with the command');
  }
  return record.view;
}

/** Parses a bounded history query and rejects hidden or duplicate query authority. */
function requireHistoryLimit(request: Request): number {
  const url = new URL(request.url);
  if (request.method !== 'GET') {
    throw new Error('Review history request is invalid');
  }
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => key !== 'limit') || url.searchParams.getAll('limit').length > 1) {
    throw new Error('Review history request is invalid');
  }
  const value = url.searchParams.get('limit');
  if (value === null || value === '') return 50;
  if (!/^(?:[1-9]|[1-9]\d|100)$/u.test(value)) {
    throw new Error('Review history limit is invalid');
  }
  return Number(value);
}

/** Validates a bounded Review collection and rejects duplicate immutable record IDs. */
function parseReviewCollection(
  value: unknown,
  expectedWorkspaceId: string,
): ReviewCompletionView[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_HISTORY_RECORDS) {
    throw new Error('Review collection is invalid');
  }
  const parsed = value.map((item) => parseReviewRecord(item, expectedWorkspaceId));
  const ids = new Set(parsed.map((item) => item.view.id));
  if (ids.size !== parsed.length) {
    throw new Error('Review collection contains duplicate identities');
  }
  return parsed.map((item) => item.view);
}

/**
 * Records one immutable weekly review through the first-party authenticated BFF.
 * Browser credentials terminate at Identity; Review receives only derived
 * workspace authority, the bounded completion command, and a correlation ID.
 */
export async function handleWeeklyReviewCompletionRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: ReviewFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let input: WeeklyReviewCompletionInput;
  let cookie: string | undefined;
  try {
    input = await parseWeeklyReviewRequest(request);
    cookie = requireCookieHeader(request);
  } catch {
    return invalidReviewRequest();
  }

  try {
    const identityOrigin = requireServiceOrigin(environment.IDENTITY_SERVICE_ORIGIN);
    const reviewOrigin = requireServiceOrigin(environment.REVIEW_SERVICE_ORIGIN);
    const secret = requireGatewaySecret(environment.REVIEW_GATEWAY_CONTEXT_SECRET);
    const correlationId = randomUUID();
    const identityResponse = await fetcher(new URL('/v1/session', identityOrigin), {
      method: 'GET',
      headers: requestHeaders({ cookie, 'x-correlation-id': correlationId }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (identityResponse.status === 401) {
      return problemResponse(
        401,
        'Authentication is required',
        'authentication_required',
      );
    }
    if (identityResponse.status !== 200) return unavailableReviewCompletion();
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const path = '/v1/reviews/weekly-review/completions';
    const reviewResponse = await fetcher(new URL(path, reviewOrigin), {
      method: 'POST',
      headers: requestHeaders({
        ...createReviewContextHeaders(
          workspaceId,
          secret,
          nowSeconds,
          'POST',
          path,
        ),
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      }),
      body: JSON.stringify(input),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (reviewResponse.status === 400) return invalidReviewRequest();
    if (reviewResponse.status === 409) return reviewCompletionConflict();
    if (reviewResponse.status !== 201) return unavailableReviewCompletion();
    const review = parseCreatedWeeklyReview(
      await readBoundedJson(reviewResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
      input,
    );
    return Response.json(review, {
      status: 201,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableReviewCompletion();
  }
}

/**
 * Lists immutable Review completion history after deriving tenant authority from
 * Identity. Replay keys, payload digests, and workspace authority stay server-side.
 */
export async function handleReviewHistoryRequest(
  request: Request,
  environment: WebEnvironment,
  fetcher: ReviewFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let limit: number;
  let cookie: string | undefined;
  try {
    limit = requireHistoryLimit(request);
    cookie = requireCookieHeader(request);
  } catch {
    return invalidReviewRequest();
  }

  try {
    const identityOrigin = requireServiceOrigin(environment.IDENTITY_SERVICE_ORIGIN);
    const reviewOrigin = requireServiceOrigin(environment.REVIEW_SERVICE_ORIGIN);
    const secret = requireGatewaySecret(environment.REVIEW_GATEWAY_CONTEXT_SECRET);
    const correlationId = randomUUID();
    const identityResponse = await fetcher(new URL('/v1/session', identityOrigin), {
      method: 'GET',
      headers: requestHeaders({ cookie, 'x-correlation-id': correlationId }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (identityResponse.status === 401) {
      return problemResponse(
        401,
        'Authentication is required',
        'authentication_required',
      );
    }
    if (identityResponse.status !== 200) return unavailableReviewHistory();
    const workspaceId = parseSessionWorkspace(
      await readBoundedJson(identityResponse, MAXIMUM_RESPONSE_BYTES),
    );
    const path = '/v1/reviews/completions';
    const historyUrl = new URL(path, reviewOrigin);
    historyUrl.searchParams.set('limit', String(limit));
    const reviewResponse = await fetcher(historyUrl, {
      method: 'GET',
      headers: requestHeaders({
        ...createReviewContextHeaders(
          workspaceId,
          secret,
          nowSeconds,
          'GET',
          path,
        ),
        'x-correlation-id': correlationId,
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (reviewResponse.status !== 200) return unavailableReviewHistory();
    const history = parseReviewCollection(
      await readBoundedJson(reviewResponse, MAXIMUM_RESPONSE_BYTES),
      workspaceId,
    );
    return Response.json(history, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return unavailableReviewHistory();
  }
}
