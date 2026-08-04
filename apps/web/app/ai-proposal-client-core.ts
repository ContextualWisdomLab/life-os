import { createHmac, randomUUID } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAXIMUM_COOKIE_BYTES = 4 * 1024;
const MAXIMUM_JSON_BYTES = 32 * 1024;
const MAXIMUM_GATEWAY_SECRET_BYTES = 4096;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_ITEMS = 200;
const MAXIMUM_RATIONALE_ITEMS = 20;
const MAXIMUM_OPERATIONS = 20;
const MAXIMUM_TEXT_LENGTH = 1_000;
const MAXIMUM_OBJECTIVE_LENGTH = 2_000;
const MAXIMUM_REASON_LENGTH = 1_000;
const MAXIMUM_LIST_RESULTS = 200;
const UPSTREAM_TIMEOUT_MS = 3_000;

/** Route descriptor supplied only by same-origin Next.js handlers. */
export type AiProposalRoute =
  | { kind: 'collection' }
  | { kind: 'proposal'; proposalId: string }
  | { kind: 'decisions'; proposalId: string };

/** Minimal fetch surface used by production and deterministic unit tests. */
export type AiProposalFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type WebEnvironment = Readonly<Record<string, string | undefined>>;
type AiMethod = 'GET' | 'POST';

/** Authenticated session principal used to create the service context. */
export interface AiSessionPrincipal {
  readonly workspaceId: string;
  readonly actorId: string;
}

/** Internal marker distinguishing invalid browser input from dependency failures. */
class InvalidAiRequestError extends Error {
  constructor() {
    super('AI proposal request is invalid');
    this.name = 'InvalidAiRequestError';
  }
}

/** Builds one credential-free RFC 9457-compatible no-store response. */
function problemResponse(
  status: number,
  title: string,
  code: string,
  correlationId?: string,
): Response {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    'content-type': 'application/problem+json',
  };
  if (correlationId) headers['x-correlation-id'] = correlationId;
  return Response.json(
    { type: 'about:blank', title, status, code },
    { status, headers },
  );
}

/** Returns the fixed malformed-browser-request problem. */
function invalidAiRequest(): Response {
  return problemResponse(
    400,
    'AI proposal request is invalid',
    'invalid_ai_request',
  );
}

/** Returns the fixed sanitized dependency/configuration problem. */
function unavailableAiProposal(correlationId?: string): Response {
  return problemResponse(
    503,
    'AI proposal service is unavailable',
    'ai_proposal_unavailable',
    correlationId,
  );
}

/** Narrows unknown JSON to a non-array record. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Requires an object and otherwise raises the requested failure class. */
function requireRecord(
  value: unknown,
  invalid: () => never = () => {
    throw new Error('AI service response is invalid');
  },
): Record<string, unknown> {
  if (!isPlainObject(value)) return invalid();
  return value;
}

/** Requires an exact closed key set. */
function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  invalid: () => never,
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(record);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

/** Requires and canonicalizes one UUIDv4 value. */
function requireUuid(value: unknown, message: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error(message);
  }
  return value.toLowerCase();
}

/** Requires one canonical lowercase UUIDv4 path parameter. */
function requireCanonicalUuid(value: unknown): string {
  if (typeof value !== 'string' || !CANONICAL_UUID_V4_PATTERN.test(value)) {
    throw new InvalidAiRequestError();
  }
  return value;
}

/** Requires a trimmed bounded string and preserves the normalized value. */
function requireString(
  value: unknown,
  maximumLength: number,
  message = 'AI service response is invalid',
): string {
  if (typeof value !== 'string') throw new Error(message);
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new Error(message);
  }
  return normalized;
}

/** Requires and canonicalizes one RFC 3339 timestamp. */
function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    throw new Error('AI service response is invalid');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('AI service response is invalid');
  }
  return new Date(parsed).toISOString();
}

/** Requires a fixed HTTP(S) service origin without credentials or path data. */
export function requireAiServiceOrigin(value: string | undefined): string {
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('AI service origin is invalid');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('AI service origin is invalid');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('AI service origin is invalid');
  }
  return parsed.origin;
}

/** Requires a bounded server-only HMAC secret. */
export function requireAiGatewaySecret(value: string | undefined): string {
  if (typeof value !== 'string') {
    throw new Error('AI gateway context secret is invalid');
  }
  const bytes = Buffer.byteLength(value, 'utf8');
  if (
    bytes < MINIMUM_GATEWAY_SECRET_BYTES ||
    bytes > MAXIMUM_GATEWAY_SECRET_BYTES ||
    /[\r\n\u0000]/u.test(value)
  ) {
    throw new Error('AI gateway context secret is invalid');
  }
  return value;
}

/** Extracts only workspace and actor identity from identity-service session data. */
export function parseAiSessionPrincipal(value: unknown): AiSessionPrincipal {
  if (!isPlainObject(value)) {
    throw new Error('Identity session response is invalid');
  }
  return Object.freeze({
    workspaceId: requireUuid(
      value.workspaceId,
      'Identity session response is invalid',
    ),
    actorId: requireUuid(value.userId, 'Identity session response is invalid'),
  });
}

/** Requires one supported method and exact canonical AI service path. */
function requireAiTarget(method: unknown, path: unknown): {
  method: AiMethod;
  path: string;
} {
  if (
    (method !== 'GET' && method !== 'POST') ||
    typeof path !== 'string' ||
    path.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    throw new Error('AI gateway context is invalid');
  }
  if (path === '/v1/proposals') return { method, path };
  const proposalMatch =
    /^\/v1\/proposals\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/decisions)?$/u.exec(
      path,
    );
  if (!proposalMatch || (proposalMatch[2] === undefined && method !== 'GET')) {
    throw new Error('AI gateway context is invalid');
  }
  return { method, path };
}

/** Creates an exact short-lived method-and-path-bound AI service context. */
export function createAiContextHeaders(
  workspaceId: string,
  actorId: string,
  secretValue: string,
  nowSeconds: number,
  methodValue: unknown,
  pathValue: unknown,
): Readonly<Record<string, string>> {
  const safeWorkspaceId = requireUuid(
    workspaceId,
    'AI gateway context is invalid',
  );
  const safeActorId = requireUuid(actorId, 'AI gateway context is invalid');
  const secret = requireAiGatewaySecret(secretValue);
  const { method, path } = requireAiTarget(methodValue, pathValue);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('AI gateway context is invalid');
  }
  const issuedAt = String(nowSeconds);
  const signature = createHmac('sha256', secret)
    .update(
      `life-os.ai-context.v1\n${safeWorkspaceId}\n${safeActorId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
  return Object.freeze({
    'x-life-os-workspace-id': safeWorkspaceId,
    'x-life-os-actor-id': safeActorId,
    'x-life-os-context-issued-at': issuedAt,
    'x-life-os-context-signature': signature,
  });
}

/** Reads a request/response stream while enforcing the byte limit before buffering. */
async function readBoundedText(
  message: Request | Response,
  maximumBytes: number,
  errorFactory: () => Error,
): Promise<string> {
  const declaredLength = message.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw errorFactory();
  }
  if (!message.body) throw errorFactory();
  const reader = message.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel('JSON body exceeds byte limit');
        throw errorFactory();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    try {
      await reader.cancel('JSON body is invalid');
    } catch {
      // Stream cancellation is best-effort after malformed input.
    }
    throw errorFactory();
  } finally {
    reader.releaseLock();
  }
  if (!text) throw errorFactory();
  return text;
}

/** Reads bounded JSON from an allowed response media type. */
async function readResponseJson(response: Response): Promise<unknown> {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0];
  if (mediaType !== 'application/json' && mediaType !== 'application/problem+json') {
    throw new Error('AI service response is invalid');
  }
  const text = await readBoundedText(
    response,
    MAXIMUM_JSON_BYTES,
    () => new Error('AI service response is invalid'),
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('AI service response is invalid');
  }
}

/** Reads and parses one bounded browser JSON body. */
async function readBrowserJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0];
  if (mediaType !== 'application/json') throw new InvalidAiRequestError();
  const text = await readBoundedText(
    request,
    MAXIMUM_JSON_BYTES,
    () => new InvalidAiRequestError(),
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidAiRequestError();
  }
}

/** Requires a bounded injection-safe cookie header. */
function requireCookie(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? undefined;
  if (
    cookie !== undefined &&
    (Buffer.byteLength(cookie, 'utf8') > MAXIMUM_COOKIE_BYTES ||
      /[\r\n\u0000]/u.test(cookie))
  ) {
    throw new InvalidAiRequestError();
  }
  return cookie;
}

/** Creates request headers while omitting undefined values. */
function requestHeaders(entries: Record<string, string | undefined>): Headers {
  const headers = new Headers({ accept: 'application/json' });
  for (const [name, value] of Object.entries(entries)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

/** Requires request-object keys to match exactly. */
function browserRecord(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new InvalidAiRequestError();
  return value;
}

/** Validates and snapshots one browser proposal request. */
function parseProposalRequest(value: unknown): unknown {
  const record = browserRecord(value);
  requireExactKeys(record, ['objective', 'context'], () => {
    throw new InvalidAiRequestError();
  });
  if (
    typeof record.objective !== 'string' ||
    !record.objective.trim() ||
    record.objective.trim().length > MAXIMUM_OBJECTIVE_LENGTH ||
    !Array.isArray(record.context) ||
    record.context.length > MAXIMUM_CONTEXT_ITEMS
  ) {
    throw new InvalidAiRequestError();
  }
  const context = record.context.map((item) => {
    const contextItem = browserRecord(item);
    requireExactKeys(contextItem, ['id', 'kind', 'title', 'status'], () => {
      throw new InvalidAiRequestError();
    });
    const kind = contextItem.kind;
    const status = contextItem.status;
    if (
      (kind !== 'goal' &&
        kind !== 'project' &&
        kind !== 'milestone' &&
        kind !== 'task' &&
        kind !== 'habit') ||
      (status !== 'active' && status !== 'blocked' && status !== 'completed') ||
      typeof contextItem.title !== 'string' ||
      !contextItem.title.trim() ||
      contextItem.title.trim().length > MAXIMUM_TEXT_LENGTH
    ) {
      throw new InvalidAiRequestError();
    }
    let id: string;
    try {
      id = requireUuid(contextItem.id, 'AI proposal request is invalid');
    } catch {
      throw new InvalidAiRequestError();
    }
    return {
      id,
      kind,
      title: contextItem.title.trim(),
      status,
    };
  });
  return { objective: record.objective.trim(), context };
}

/** Validates and snapshots one browser decision request. */
function parseDecisionRequest(value: unknown): unknown {
  const record = browserRecord(value);
  const hasReason = Object.hasOwn(record, 'reason');
  requireExactKeys(
    record,
    hasReason
      ? [
          'expectedContentDigest',
          'idempotencyKey',
          'decision',
          'reason',
          'decidedAt',
        ]
      : ['expectedContentDigest', 'idempotencyKey', 'decision', 'decidedAt'],
    () => {
      throw new InvalidAiRequestError();
    },
  );
  if (
    typeof record.expectedContentDigest !== 'string' ||
    !SHA_256_PATTERN.test(record.expectedContentDigest.toLowerCase()) ||
    (record.decision !== 'accepted' && record.decision !== 'rejected') ||
    typeof record.decidedAt !== 'string' ||
    !RFC_3339_TIMESTAMP_PATTERN.test(record.decidedAt) ||
    !Number.isFinite(Date.parse(record.decidedAt)) ||
    (hasReason &&
      (typeof record.reason !== 'string' ||
        !record.reason.trim() ||
        record.reason.trim().length > MAXIMUM_REASON_LENGTH))
  ) {
    throw new InvalidAiRequestError();
  }
  let idempotencyKey: string;
  try {
    idempotencyKey = requireUuid(
      record.idempotencyKey,
      'AI proposal request is invalid',
    );
  } catch {
    throw new InvalidAiRequestError();
  }
  return {
    expectedContentDigest: record.expectedContentDigest.toLowerCase(),
    idempotencyKey,
    decision: record.decision,
    ...(hasReason ? { reason: (record.reason as string).trim() } : {}),
    decidedAt: new Date(record.decidedAt).toISOString(),
  };
}

/** Resolves and validates the exact browser and upstream route contract. */
async function parseBrowserRequest(
  request: Request,
  route: AiProposalRoute,
): Promise<{ method: AiMethod; path: string; body?: unknown; cookie?: string }> {
  const url = new URL(request.url);
  if (url.search || url.hash) throw new InvalidAiRequestError();
  const method = request.method;
  let expectedBrowserPath: string;
  let path: string;
  if (route.kind === 'collection') {
    expectedBrowserPath = '/api/ai/proposals';
    path = '/v1/proposals';
    if (method !== 'GET' && method !== 'POST') throw new InvalidAiRequestError();
  } else {
    const proposalId = requireCanonicalUuid(route.proposalId);
    if (route.kind === 'proposal') {
      expectedBrowserPath = `/api/ai/proposals/${proposalId}`;
      path = `/v1/proposals/${proposalId}`;
      if (method !== 'GET') throw new InvalidAiRequestError();
    } else {
      expectedBrowserPath = `/api/ai/proposals/${proposalId}/decisions`;
      path = `/v1/proposals/${proposalId}/decisions`;
      if (method !== 'GET' && method !== 'POST') throw new InvalidAiRequestError();
    }
  }
  if (url.pathname !== expectedBrowserPath) throw new InvalidAiRequestError();
  const cookie = requireCookie(request);
  if (method === 'GET') return { method, path, cookie };
  const bodyValue = await readBrowserJson(request);
  const body =
    route.kind === 'collection'
      ? parseProposalRequest(bodyValue)
      : parseDecisionRequest(bodyValue);
  return { method, path, body, cookie };
}

/** Parses one bounded proposal response. */
function parseProposal(value: unknown): Record<string, unknown> {
  const record = requireRecord(value);
  requireExactKeys(
    record,
    [
      'proposalId',
      'workspaceId',
      'summary',
      'rationale',
      'operations',
      'requiresConfirmation',
      'createdAt',
    ],
    () => {
      throw new Error('AI service response is invalid');
    },
  );
  if (
    !Array.isArray(record.rationale) ||
    record.rationale.length === 0 ||
    record.rationale.length > MAXIMUM_RATIONALE_ITEMS ||
    !Array.isArray(record.operations) ||
    record.operations.length === 0 ||
    record.operations.length > MAXIMUM_OPERATIONS ||
    record.requiresConfirmation !== true
  ) {
    throw new Error('AI service response is invalid');
  }
  const rationale = record.rationale.map((item) =>
    requireString(item, MAXIMUM_TEXT_LENGTH),
  );
  const operations = record.operations.map((item) => {
    const operation = requireRecord(item);
    const hasTargetId = Object.hasOwn(operation, 'targetId');
    requireExactKeys(
      operation,
      hasTargetId ? ['kind', 'description', 'targetId'] : ['kind', 'description'],
      () => {
        throw new Error('AI service response is invalid');
      },
    );
    if (
      operation.kind !== 'create_task' &&
      operation.kind !== 'prioritize_item' &&
      operation.kind !== 'schedule_item'
    ) {
      throw new Error('AI service response is invalid');
    }
    return {
      kind: operation.kind,
      description: requireString(operation.description, MAXIMUM_TEXT_LENGTH),
      ...(hasTargetId
        ? {
            targetId: requireUuid(
              operation.targetId,
              'AI service response is invalid',
            ),
          }
        : {}),
    };
  });
  return {
    proposalId: requireUuid(record.proposalId, 'AI service response is invalid'),
    workspaceId: requireUuid(record.workspaceId, 'AI service response is invalid'),
    summary: requireString(record.summary, MAXIMUM_TEXT_LENGTH),
    rationale,
    operations,
    requiresConfirmation: true,
    createdAt: requireTimestamp(record.createdAt),
  };
}

/** Parses one proposal request echoed in immutable audit evidence. */
function parseStoredRequest(value: unknown): unknown {
  try {
    const record = parseProposalRequest(value) as Record<string, unknown>;
    return record;
  } catch {
    throw new Error('AI service response is invalid');
  }
}

/** Parses one immutable proposal audit record. */
function parseAuditRecord(value: unknown): Record<string, unknown> {
  const record = requireRecord(value);
  requireExactKeys(
    record,
    [
      'proposal',
      'request',
      'modelId',
      'requestDigest',
      'contentDigest',
      'recordedAt',
    ],
    () => {
      throw new Error('AI service response is invalid');
    },
  );
  if (
    typeof record.requestDigest !== 'string' ||
    !SHA_256_PATTERN.test(record.requestDigest) ||
    typeof record.contentDigest !== 'string' ||
    !SHA_256_PATTERN.test(record.contentDigest)
  ) {
    throw new Error('AI service response is invalid');
  }
  return {
    proposal: parseProposal(record.proposal),
    request: parseStoredRequest(record.request),
    modelId: requireString(record.modelId, 200),
    requestDigest: record.requestDigest,
    contentDigest: record.contentDigest,
    recordedAt: requireTimestamp(record.recordedAt),
  };
}

/** Parses one append-only decision event. */
function parseDecisionEvent(value: unknown): Record<string, unknown> {
  const record = requireRecord(value);
  const hasReason = Object.hasOwn(record, 'reason');
  requireExactKeys(
    record,
    hasReason
      ? [
          'id',
          'workspaceId',
          'proposalId',
          'proposalContentDigest',
          'actorId',
          'decision',
          'reason',
          'idempotencyKey',
          'decidedAt',
          'recordedAt',
        ]
      : [
          'id',
          'workspaceId',
          'proposalId',
          'proposalContentDigest',
          'actorId',
          'decision',
          'idempotencyKey',
          'decidedAt',
          'recordedAt',
        ],
    () => {
      throw new Error('AI service response is invalid');
    },
  );
  if (
    typeof record.proposalContentDigest !== 'string' ||
    !SHA_256_PATTERN.test(record.proposalContentDigest) ||
    (record.decision !== 'accepted' && record.decision !== 'rejected')
  ) {
    throw new Error('AI service response is invalid');
  }
  return {
    id: requireUuid(record.id, 'AI service response is invalid'),
    workspaceId: requireUuid(record.workspaceId, 'AI service response is invalid'),
    proposalId: requireUuid(record.proposalId, 'AI service response is invalid'),
    proposalContentDigest: record.proposalContentDigest,
    actorId: requireUuid(record.actorId, 'AI service response is invalid'),
    decision: record.decision,
    ...(hasReason
      ? { reason: requireString(record.reason, MAXIMUM_REASON_LENGTH) }
      : {}),
    idempotencyKey: requireUuid(
      record.idempotencyKey,
      'AI service response is invalid',
    ),
    decidedAt: requireTimestamp(record.decidedAt),
    recordedAt: requireTimestamp(record.recordedAt),
  };
}

/** Validates one successful response according to method and route. */
function parseSuccessfulResponse(
  value: unknown,
  route: AiProposalRoute,
  method: AiMethod,
): unknown {
  if (route.kind === 'collection') {
    if (method === 'POST') return parseProposal(value);
    if (!Array.isArray(value) || value.length > MAXIMUM_LIST_RESULTS) {
      throw new Error('AI service response is invalid');
    }
    return value.map(parseAuditRecord);
  }
  if (route.kind === 'proposal') return parseAuditRecord(value);
  if (method === 'POST') return parseDecisionEvent(value);
  if (!Array.isArray(value) || value.length > MAXIMUM_LIST_RESULTS) {
    throw new Error('AI service response is invalid');
  }
  return value.map(parseDecisionEvent);
}

/** Returns only explicitly tenant-safe upstream problems with fixed local titles. */
async function safeProblemResponse(
  response: Response,
  correlationId: string,
): Promise<Response | undefined> {
  const value = await readResponseJson(response);
  if (!isPlainObject(value) || value.status !== response.status) return undefined;
  const code = value.code;
  if (response.status === 404 && code === 'proposal_not_found') {
    return problemResponse(
      404,
      'Proposal was not found',
      'proposal_not_found',
      correlationId,
    );
  }
  if (response.status === 409 && code === 'stale_proposal') {
    return problemResponse(
      409,
      'Proposal revision is stale',
      'stale_proposal',
      correlationId,
    );
  }
  if (response.status === 409 && code === 'idempotency_conflict') {
    return problemResponse(
      409,
      'Decision idempotency key conflicts with an earlier request',
      'idempotency_conflict',
      correlationId,
    );
  }
  return undefined;
}

/**
 * Authenticates the browser through identity-service, derives tenant and actor
 * scope, signs one exact AI request, and validates the bounded upstream result.
 */
export async function handleAiProposalRequest(
  request: Request,
  environment: WebEnvironment,
  route: AiProposalRoute,
  fetcher: AiProposalFetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response> {
  let parsedRequest: Awaited<ReturnType<typeof parseBrowserRequest>>;
  try {
    parsedRequest = await parseBrowserRequest(request, route);
  } catch (error) {
    if (error instanceof InvalidAiRequestError) return invalidAiRequest();
    return invalidAiRequest();
  }

  const correlationId = randomUUID();
  try {
    const identityOrigin = requireAiServiceOrigin(
      environment.IDENTITY_SERVICE_ORIGIN,
    );
    const aiOrigin = requireAiServiceOrigin(environment.AI_SERVICE_ORIGIN);
    const secret = requireAiGatewaySecret(
      environment.AI_GATEWAY_CONTEXT_SECRET,
    );
    const identityResponse = await fetcher(
      new URL('/v1/session', identityOrigin),
      {
        method: 'GET',
        headers: requestHeaders({
          cookie: parsedRequest.cookie,
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
        correlationId,
      );
    }
    if (identityResponse.status !== 200) {
      return unavailableAiProposal(correlationId);
    }
    const principal = parseAiSessionPrincipal(
      await readResponseJson(identityResponse),
    );
    const contextHeaders = createAiContextHeaders(
      principal.workspaceId,
      principal.actorId,
      secret,
      nowSeconds,
      parsedRequest.method,
      parsedRequest.path,
    );
    const payload =
      parsedRequest.body === undefined
        ? undefined
        : JSON.stringify(parsedRequest.body);
    const aiResponse = await fetcher(
      new URL(parsedRequest.path, aiOrigin),
      {
        method: parsedRequest.method,
        headers: requestHeaders({
          ...contextHeaders,
          'x-correlation-id': correlationId,
          ...(payload === undefined
            ? {}
            : {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(payload)),
              }),
        }),
        ...(payload === undefined ? {} : { body: payload }),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      },
    );
    const expectedStatus = parsedRequest.method === 'POST' ? 201 : 200;
    if (aiResponse.status !== expectedStatus) {
      const safe = await safeProblemResponse(aiResponse, correlationId);
      return safe ?? unavailableAiProposal(correlationId);
    }
    const result = parseSuccessfulResponse(
      await readResponseJson(aiResponse),
      route,
      parsedRequest.method,
    );
    return Response.json(result, {
      status: expectedStatus,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'x-correlation-id': correlationId,
      },
    });
  } catch {
    return unavailableAiProposal(correlationId);
  }
}
