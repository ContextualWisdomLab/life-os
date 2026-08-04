import { createHmac, timingSafeEqual } from 'node:crypto';

/** Headers emitted by the private gateway after authenticating one actor and workspace. */
export interface TrustedAiContextHeaders {
  workspaceId: unknown;
  actorId: unknown;
  issuedAt: unknown;
  signature: unknown;
}

/** Authenticated tenant and actor scope accepted by the AI proposal boundary. */
export interface TrustedAiContext {
  readonly workspaceId: string;
  readonly actorId: string;
}

/** Stable verifier failure classifications mapped by the HTTP boundary. */
export type AiGatewayContextFailure =
  | 'invalid_gateway_context'
  | 'gateway_context_unavailable';

/** Credential-free error raised when trusted gateway context cannot be accepted. */
export class AiGatewayContextError extends Error {
  constructor(readonly failure: AiGatewayContextFailure) {
    super(failure);
    this.name = 'AiGatewayContextError';
  }
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;

/** Raises one stable invalid-context failure without retaining untrusted input. */
function invalidGatewayContext(): never {
  throw new AiGatewayContextError('invalid_gateway_context');
}

/** Raises one stable configuration failure without exposing secret material. */
function unavailableGatewayContext(): never {
  throw new AiGatewayContextError('gateway_context_unavailable');
}

/** Computes the versioned HMAC digest shared by the private gateway and AI service. */
function aiContextDigest(
  workspaceId: string,
  actorId: string,
  issuedAt: string,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(
      `life-os.ai-context.v1\n${workspaceId}\n${actorId}\n${issuedAt}`,
      'utf8',
    )
    .digest();
}

/**
 * Verifies a short-lived context created only after gateway authentication.
 * Legacy client-selected ownership headers are deliberately outside this contract.
 */
export function requireTrustedAiContext(
  headers: TrustedAiContextHeaders,
  secret: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): TrustedAiContext {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES
  ) {
    return unavailableGatewayContext();
  }
  if (
    typeof headers.workspaceId !== 'string' ||
    typeof headers.actorId !== 'string' ||
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UUID_V4_PATTERN.test(headers.workspaceId) ||
    !UUID_V4_PATTERN.test(headers.actorId) ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return invalidGatewayContext();
  }

  const workspaceId = headers.workspaceId.toLowerCase();
  const actorId = headers.actorId.toLowerCase();
  const issuedAtSeconds = Number(headers.issuedAt);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS
  ) {
    return invalidGatewayContext();
  }

  const expected = aiContextDigest(
    workspaceId,
    actorId,
    headers.issuedAt,
    secret,
  );
  const actual = Buffer.from(headers.signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return invalidGatewayContext();
  }

  return Object.freeze({ workspaceId, actorId });
}
