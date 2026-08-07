import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PATH_PATTERN = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,255}$/u;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_SECRET_BYTES = 4_096;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 60;
const EXPECTED_HEADER_NAMES = Object.freeze([
  'x-life-os-context-key-id',
  'x-life-os-workspace-id',
  'x-life-os-actor-id',
  'x-life-os-context-issued-at',
  'x-life-os-context-signature',
]);

/** One identified HMAC key for the private privacy-service trust boundary. */
export interface PrivacyServiceContextKey {
  readonly keyId: string;
  readonly secret: string;
}

/** Active signing key plus one optional previous verification-only key. */
export interface PrivacyServiceContextKeyRing {
  readonly active: PrivacyServiceContextKey;
  readonly previous?: PrivacyServiceContextKey;
}

/** Environment accepted by the private service-context key parser. */
export interface PrivacyServiceContextKeyEnvironment {
  readonly PRIVACY_CONTEXT_ACTIVE_KEY_ID?: string;
  readonly PRIVACY_CONTEXT_ACTIVE_KEY_SECRET?: string;
  readonly PRIVACY_CONTEXT_PREVIOUS_KEY_ID?: string;
  readonly PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET?: string;
}

/** Exact ownership and request identity signed by a trusted gateway. */
export interface PrivacyServiceContextInput {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly method: string;
  readonly path: string;
  readonly issuedAt: Date;
}

/** Header map emitted by the trusted signer. */
export interface PrivacyServiceContextHeaders {
  readonly 'x-life-os-context-key-id': string;
  readonly 'x-life-os-workspace-id': string;
  readonly 'x-life-os-actor-id': string;
  readonly 'x-life-os-context-issued-at': string;
  readonly 'x-life-os-context-signature': string;
}

/** Verified tenant and actor identity used by the application boundary. */
export interface VerifiedPrivacyServiceContext {
  readonly workspaceId: string;
  readonly actorId: string;
}

/** Stable sanitized context failure without key, signature, or tenant details. */
export class PrivacyServiceContextError extends Error {
  /** Creates one credential-free private-context failure. */
  constructor() {
    super('Privacy service context is invalid');
    this.name = 'PrivacyServiceContextError';
  }
}

function invalid(): never {
  throw new PrivacyServiceContextError();
}

function requireKeyId(value: unknown): string {
  return typeof value === 'string' && KEY_ID_PATTERN.test(value)
    ? value
    : invalid();
}

function requireSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    /[\r\n\u0000]/u.test(value)
  ) {
    return invalid();
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  return byteLength >= MINIMUM_SECRET_BYTES &&
    byteLength <= MAXIMUM_SECRET_BYTES
    ? value
    : invalid();
}

function key(keyId: unknown, secret: unknown): PrivacyServiceContextKey {
  return Object.freeze({
    keyId: requireKeyId(keyId),
    secret: requireSecret(secret),
  });
}

/** Parses and freezes one complete active/previous context key ring. */
export function parsePrivacyServiceContextKeyRing(
  environment: PrivacyServiceContextKeyEnvironment,
): PrivacyServiceContextKeyRing {
  if (!environment || typeof environment !== 'object') {
    return invalid();
  }
  const active = key(
    environment.PRIVACY_CONTEXT_ACTIVE_KEY_ID,
    environment.PRIVACY_CONTEXT_ACTIVE_KEY_SECRET,
  );
  const previousId = environment.PRIVACY_CONTEXT_PREVIOUS_KEY_ID;
  const previousSecret = environment.PRIVACY_CONTEXT_PREVIOUS_KEY_SECRET;
  if ((previousId === undefined) !== (previousSecret === undefined)) {
    return invalid();
  }
  if (previousId === undefined) {
    return Object.freeze({ active });
  }
  const previous = key(previousId, previousSecret);
  if (
    active.keyId === previous.keyId ||
    active.secret === previous.secret
  ) {
    return invalid();
  }
  return Object.freeze({ active, previous });
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim().toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : invalid();
}

function requireMethod(value: unknown): string {
  if (typeof value !== 'string' || /[\r\n\u0000]/u.test(value)) {
    return invalid();
  }
  const method = value.toUpperCase();
  return ALLOWED_METHODS.has(method) ? method : invalid();
}

function requirePath(value: unknown): string {
  return typeof value === 'string' &&
    PATH_PATTERN.test(value) &&
    !value.includes('?') &&
    !value.includes('#')
    ? value
    : invalid();
}

function requireIssuedAt(value: unknown): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return invalid();
  }
  const milliseconds = value.getTime();
  if (milliseconds % 1_000 !== 0) {
    return invalid();
  }
  return Math.floor(milliseconds / 1_000);
}

function canonicalPayload(input: {
  keyId: string;
  workspaceId: string;
  actorId: string;
  issuedAtSeconds: number;
  method: string;
  path: string;
}): string {
  return [
    'life-os.privacy-service-context.v1',
    input.keyId,
    input.workspaceId,
    input.actorId,
    String(input.issuedAtSeconds),
    input.method,
    input.path,
  ].join('\n');
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

/** Creates one exact signed private-context header set using only the active key. */
export function createPrivacyServiceContextHeaders(
  input: PrivacyServiceContextInput,
  keyRing: PrivacyServiceContextKeyRing,
): PrivacyServiceContextHeaders {
  if (!input || typeof input !== 'object' || !keyRing) {
    return invalid();
  }
  const active = key(keyRing.active?.keyId, keyRing.active?.secret);
  const workspaceId = requireUuid(input.workspaceId);
  const actorId = requireUuid(input.actorId);
  const method = requireMethod(input.method);
  const path = requirePath(input.path);
  const issuedAtSeconds = requireIssuedAt(input.issuedAt);
  const payload = canonicalPayload({
    keyId: active.keyId,
    workspaceId,
    actorId,
    issuedAtSeconds,
    method,
    path,
  });
  return Object.freeze({
    'x-life-os-context-key-id': active.keyId,
    'x-life-os-workspace-id': workspaceId,
    'x-life-os-actor-id': actorId,
    'x-life-os-context-issued-at': String(issuedAtSeconds),
    'x-life-os-context-signature': signature(payload, active.secret),
  });
}

function exactHeaderRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  const keys = Object.keys(value).map((name) => name.toLowerCase());
  if (
    keys.length !== EXPECTED_HEADER_NAMES.length ||
    keys.some((name) => !EXPECTED_HEADER_NAMES.includes(name)) ||
    new Set(keys).size !== keys.length
  ) {
    return invalid();
  }
  return value;
}

function header(
  value: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const entry = Object.entries(value).find(
    ([candidate]) => candidate.toLowerCase() === name,
  )?.[1];
  return typeof entry === 'string' && entry.length > 0 ? entry : invalid();
}

function verificationKey(
  keyRing: PrivacyServiceContextKeyRing,
  keyId: string,
): PrivacyServiceContextKey {
  const active = key(keyRing.active?.keyId, keyRing.active?.secret);
  if (active.keyId === keyId) {
    return active;
  }
  if (keyRing.previous !== undefined) {
    const previous = key(
      keyRing.previous.keyId,
      keyRing.previous.secret,
    );
    if (previous.keyId === keyId) {
      return previous;
    }
  }
  return invalid();
}

function verifySignature(
  payload: string,
  provided: string,
  secret: string,
): void {
  if (!BASE64URL_PATTERN.test(provided)) {
    return invalid();
  }
  const expected = Buffer.from(signature(payload, secret), 'base64url');
  const actual = Buffer.from(provided, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    invalid();
  }
}

/**
 * Verifies one exact private context against method, path, age, ownership, and
 * the selected active or previous HMAC key.
 */
export function verifyPrivacyServiceContext(
  headersValue: Readonly<Record<string, unknown>>,
  keyRing: PrivacyServiceContextKeyRing,
  methodValue: string,
  pathValue: string,
  nowValue: Date,
): VerifiedPrivacyServiceContext {
  const headers = exactHeaderRecord(headersValue);
  const keyId = requireKeyId(
    header(headers, 'x-life-os-context-key-id'),
  );
  const workspaceId = requireUuid(
    header(headers, 'x-life-os-workspace-id'),
  );
  const actorId = requireUuid(header(headers, 'x-life-os-actor-id'));
  const issuedAtText = header(headers, 'x-life-os-context-issued-at');
  if (!/^\d{10}$/u.test(issuedAtText)) {
    return invalid();
  }
  const issuedAtSeconds = Number(issuedAtText);
  if (!Number.isSafeInteger(issuedAtSeconds)) {
    return invalid();
  }
  const method = requireMethod(methodValue);
  const path = requirePath(pathValue);
  if (!(nowValue instanceof Date) || Number.isNaN(nowValue.getTime())) {
    return invalid();
  }
  const nowSeconds = Math.floor(nowValue.getTime() / 1_000);
  const age = nowSeconds - issuedAtSeconds;
  if (
    age > MAXIMUM_CONTEXT_AGE_SECONDS ||
    age < -MAXIMUM_FUTURE_SKEW_SECONDS
  ) {
    return invalid();
  }
  const selected = verificationKey(keyRing, keyId);
  const payload = canonicalPayload({
    keyId,
    workspaceId,
    actorId,
    issuedAtSeconds,
    method,
    path,
  });
  verifySignature(
    payload,
    header(headers, 'x-life-os-context-signature'),
    selected.secret,
  );
  return Object.freeze({ workspaceId, actorId });
}
