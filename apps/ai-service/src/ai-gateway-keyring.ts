/** One explicitly identified HMAC key used at the private gateway boundary. */
export interface AiGatewayContextKey {
  readonly keyId: string;
  readonly secret: string;
}

/** One active key and an optional previous verification-only overlap key. */
export interface AiGatewayContextKeyRing {
  readonly active: AiGatewayContextKey;
  readonly previous?: AiGatewayContextKey;
}

/** Environment surface required to configure bounded gateway key rotation. */
export interface AiGatewayContextKeyEnvironment {
  readonly AI_GATEWAY_ACTIVE_KEY_ID?: string;
  readonly AI_GATEWAY_ACTIVE_KEY_SECRET?: string;
  readonly AI_GATEWAY_PREVIOUS_KEY_ID?: string;
  readonly AI_GATEWAY_PREVIOUS_KEY_SECRET?: string;
}

/** Sanitized configuration failure that never retains key material. */
export class AiGatewayKeyConfigurationError extends Error {
  /** Creates one stable configuration failure without interpolating input. */
  constructor() {
    super('AI gateway key configuration is invalid');
    this.name = 'AiGatewayKeyConfigurationError';
  }
}

/** Sanitized request failure for malformed, unknown, or retired key identifiers. */
export class AiGatewayKeySelectionError extends Error {
  /** Creates one stable selection failure without interpolating input. */
  constructor() {
    super('AI gateway key identifier is invalid');
    this.name = 'AiGatewayKeySelectionError';
  }
}

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_SECRET_BYTES = 4096;

/** Requires one bounded case-sensitive opaque identifier safe for header lookup. */
export function requireAiGatewayKeyId(value: unknown): string {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value)) {
    throw new AiGatewayKeyConfigurationError();
  }
  return value;
}

/** Requires independently generated bounded HMAC key material. */
export function requireAiGatewayKeySecret(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AiGatewayKeyConfigurationError();
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (
    byteLength < MINIMUM_SECRET_BYTES ||
    byteLength > MAXIMUM_SECRET_BYTES ||
    /[\r\n\u0000]/u.test(value)
  ) {
    throw new AiGatewayKeyConfigurationError();
  }
  return value;
}

/** Creates one immutable key after validating identifier and secret independently. */
function contextKey(keyId: unknown, secret: unknown): AiGatewayContextKey {
  return Object.freeze({
    keyId: requireAiGatewayKeyId(keyId),
    secret: requireAiGatewayKeySecret(secret),
  });
}

/**
 * Parses exactly one active signing key and at most one complete previous key.
 * Partial, duplicate, or reused-secret overlap configuration fails closed.
 */
export function requireAiGatewayContextKeyRing(
  environment: AiGatewayContextKeyEnvironment,
): AiGatewayContextKeyRing {
  if (!environment || typeof environment !== 'object') {
    throw new AiGatewayKeyConfigurationError();
  }
  const active = contextKey(
    environment.AI_GATEWAY_ACTIVE_KEY_ID,
    environment.AI_GATEWAY_ACTIVE_KEY_SECRET,
  );
  const previousId = environment.AI_GATEWAY_PREVIOUS_KEY_ID;
  const previousSecret = environment.AI_GATEWAY_PREVIOUS_KEY_SECRET;
  const hasPreviousId = previousId !== undefined;
  const hasPreviousSecret = previousSecret !== undefined;
  if (hasPreviousId !== hasPreviousSecret) {
    throw new AiGatewayKeyConfigurationError();
  }
  if (!hasPreviousId) {
    return Object.freeze({ active });
  }
  const previous = contextKey(previousId, previousSecret);
  if (previous.keyId === active.keyId || previous.secret === active.secret) {
    throw new AiGatewayKeyConfigurationError();
  }
  return Object.freeze({ active, previous });
}

/**
 * Selects exactly the explicitly identified configured key without trial
 * verification against unrelated keys.
 */
export function selectAiGatewayVerificationKey(
  keyRing: AiGatewayContextKeyRing,
  keyIdValue: unknown,
): AiGatewayContextKey {
  if (typeof keyIdValue !== 'string' || !KEY_ID_PATTERN.test(keyIdValue)) {
    throw new AiGatewayKeySelectionError();
  }
  if (keyIdValue === keyRing.active.keyId) {
    return keyRing.active;
  }
  if (keyRing.previous && keyIdValue === keyRing.previous.keyId) {
    return keyRing.previous;
  }
  throw new AiGatewayKeySelectionError();
}
