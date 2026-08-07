import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PRIVACY_ACCESS_ACTIONS,
  PRIVACY_ACCESS_POLICY_DIGEST,
  PRIVACY_ACCESS_POLICY_REVISION_ID,
  PRIVACY_ACCESS_PURPOSES,
  PRIVACY_RESOURCE_CATEGORIES,
  type PrivacyAccessAction,
  type PrivacyAccessDecision,
  type PrivacyAccessMode,
  type PrivacyAccessPurpose,
  type PrivacyResourceCategory,
} from './privacy-access-domain';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_SECRET_BYTES = 4_096;
const MAXIMUM_TOKEN_CHARACTERS = 16_384;
const MAXIMUM_CLOCK_SKEW_MILLISECONDS = 60_000;
const MAXIMUM_ORDINARY_TTL_MILLISECONDS = 900_000;
const MAXIMUM_BREAK_GLASS_TTL_MILLISECONDS = 300_000;

/** Versioned schema identifier for compact privacy access grants. */
export const PRIVACY_ACCESS_GRANT_SCHEMA =
  'life-os.privacy-access-grant.v1' as const;

/** One explicitly identified HMAC key used to sign or verify access grants. */
export interface PrivacyGrantKey {
  readonly keyId: string;
  readonly secret: string;
}

/** One active signing key and an optional previous verification-only key. */
export interface PrivacyGrantKeyRing {
  readonly active: PrivacyGrantKey;
  readonly previous?: PrivacyGrantKey;
}

/** Environment surface accepted by the privacy grant key parser. */
export interface PrivacyGrantKeyEnvironment {
  readonly PRIVACY_GRANT_ACTIVE_KEY_ID?: string;
  readonly PRIVACY_GRANT_ACTIVE_KEY_SECRET?: string;
  readonly PRIVACY_GRANT_PREVIOUS_KEY_ID?: string;
  readonly PRIVACY_GRANT_PREVIOUS_KEY_SECRET?: string;
}

/** Exact trusted context required when consuming a grant token. */
export interface PrivacyGrantVerificationContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly now: Date;
}

/** Canonical immutable claims carried by one compact access grant. */
export interface PrivacyAccessGrantClaims {
  readonly schema: typeof PRIVACY_ACCESS_GRANT_SCHEMA;
  readonly keyId: string;
  readonly grantId: string;
  readonly decisionId: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly purpose: PrivacyAccessPurpose;
  readonly action: PrivacyAccessAction;
  readonly resourceCategory: PrivacyResourceCategory;
  readonly accessMode: PrivacyAccessMode;
  readonly policyRevisionId: string;
  readonly policyDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** Stable sanitized failure for key configuration, signing, or verification. */
export class PrivacyAccessTokenError extends Error {
  /** Creates one error without retaining credentials, tokens, or rejected input. */
  constructor() {
    super('Privacy access grant token is invalid');
    this.name = 'PrivacyAccessTokenError';
  }
}

function invalid(): never {
  throw new PrivacyAccessTokenError();
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

function key(valueId: unknown, valueSecret: unknown): PrivacyGrantKey {
  return Object.freeze({
    keyId: requireKeyId(valueId),
    secret: requireSecret(valueSecret),
  });
}

/** Parses and freezes one complete active/previous grant-key configuration. */
export function parsePrivacyGrantKeyRing(
  environment: PrivacyGrantKeyEnvironment,
): PrivacyGrantKeyRing {
  if (!environment || typeof environment !== 'object') {
    return invalid();
  }
  const active = key(
    environment.PRIVACY_GRANT_ACTIVE_KEY_ID,
    environment.PRIVACY_GRANT_ACTIVE_KEY_SECRET,
  );
  const previousId = environment.PRIVACY_GRANT_PREVIOUS_KEY_ID;
  const previousSecret = environment.PRIVACY_GRANT_PREVIOUS_KEY_SECRET;
  if ((previousId === undefined) !== (previousSecret === undefined)) {
    return invalid();
  }
  if (previousId === undefined) {
    return Object.freeze({ active });
  }
  const previous = key(previousId, previousSecret);
  if (
    previous.keyId === active.keyId ||
    previous.secret === active.secret
  ) {
    return invalid();
  }
  return Object.freeze({ active, previous });
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.toLowerCase();
  return UUID_V4_PATTERN.test(normalized) ? normalized : invalid();
}

function requirePurpose(value: unknown): PrivacyAccessPurpose {
  return typeof value === 'string' &&
    (PRIVACY_ACCESS_PURPOSES as readonly string[]).includes(value)
    ? (value as PrivacyAccessPurpose)
    : invalid();
}

function requireAction(value: unknown): PrivacyAccessAction {
  return typeof value === 'string' &&
    (PRIVACY_ACCESS_ACTIONS as readonly string[]).includes(value)
    ? (value as PrivacyAccessAction)
    : invalid();
}

function requireCategory(value: unknown): PrivacyResourceCategory {
  return typeof value === 'string' &&
    (PRIVACY_RESOURCE_CATEGORIES as readonly string[]).includes(value)
    ? (value as PrivacyResourceCategory)
    : invalid();
}

function requireMode(value: unknown): PrivacyAccessMode {
  return value === 'ordinary' || value === 'break_glass' ? value : invalid();
}

function requireCanonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return invalid();
  }
  const canonical = new Date(parsed).toISOString();
  return canonical === value ? value : invalid();
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.size ||
    actual.some((name) => !expected.has(name))
  ) {
    invalid();
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : invalid();
}

function canonicalClaims(
  decision: PrivacyAccessDecision,
  signingKeyId: string,
): PrivacyAccessGrantClaims {
  if (
    decision.outcome !== 'allowed' ||
    decision.grantId === undefined ||
    decision.expiresAt === undefined ||
    decision.policyRevisionId !== PRIVACY_ACCESS_POLICY_REVISION_ID ||
    decision.policyDigest !== PRIVACY_ACCESS_POLICY_DIGEST
  ) {
    return invalid();
  }
  const issuedAt = requireCanonicalTimestamp(decision.issuedAt);
  const expiresAt = requireCanonicalTimestamp(decision.expiresAt);
  const mode = requireMode(decision.accessMode);
  const ttl = Date.parse(expiresAt) - Date.parse(issuedAt);
  const maximum =
    mode === 'break_glass'
      ? MAXIMUM_BREAK_GLASS_TTL_MILLISECONDS
      : MAXIMUM_ORDINARY_TTL_MILLISECONDS;
  if (ttl < 30_000 || ttl > maximum) {
    return invalid();
  }
  return Object.freeze({
    schema: PRIVACY_ACCESS_GRANT_SCHEMA,
    keyId: requireKeyId(signingKeyId),
    grantId: requireUuidV4(decision.grantId),
    decisionId: requireUuidV4(decision.decisionId),
    workspaceId: requireUuidV4(decision.workspaceId),
    actorId: requireUuidV4(decision.actorId),
    purpose: requirePurpose(decision.purpose),
    action: requireAction(decision.action),
    resourceCategory: requireCategory(decision.resourceCategory),
    accessMode: mode,
    policyRevisionId: requireUuidV4(decision.policyRevisionId),
    policyDigest: SHA_256_PATTERN.test(decision.policyDigest)
      ? decision.policyDigest
      : invalid(),
    issuedAt,
    expiresAt,
  });
}

function serializeClaims(claims: PrivacyAccessGrantClaims): string {
  return JSON.stringify({
    schema: claims.schema,
    keyId: claims.keyId,
    grantId: claims.grantId,
    decisionId: claims.decisionId,
    workspaceId: claims.workspaceId,
    actorId: claims.actorId,
    purpose: claims.purpose,
    action: claims.action,
    resourceCategory: claims.resourceCategory,
    accessMode: claims.accessMode,
    policyRevisionId: claims.policyRevisionId,
    policyDigest: claims.policyDigest,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  });
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'ascii').digest('base64url');
}

/** Creates one canonical compact grant using only the active signing key. */
export function createPrivacyAccessGrantToken(
  decision: PrivacyAccessDecision,
  keyRing: PrivacyGrantKeyRing,
): string {
  if (!keyRing || typeof keyRing !== 'object') {
    return invalid();
  }
  const active = key(keyRing.active?.keyId, keyRing.active?.secret);
  const claims = canonicalClaims(decision, active.keyId);
  const payload = Buffer.from(serializeClaims(claims), 'utf8').toString(
    'base64url',
  );
  const signature = sign(payload, active.secret);
  return `${payload}.${signature}`;
}

function decodePayload(value: string): Readonly<Record<string, unknown>> {
  if (
    value === '' ||
    value.length > MAXIMUM_TOKEN_CHARACTERS ||
    !BASE64URL_PATTERN.test(value)
  ) {
    return invalid();
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(value, 'base64url'),
    );
  } catch {
    return invalid();
  }
  try {
    return record(JSON.parse(decoded) as unknown);
  } catch {
    return invalid();
  }
}

function parseClaims(value: Readonly<Record<string, unknown>>): PrivacyAccessGrantClaims {
  requireExactKeys(value, [
    'schema',
    'keyId',
    'grantId',
    'decisionId',
    'workspaceId',
    'actorId',
    'purpose',
    'action',
    'resourceCategory',
    'accessMode',
    'policyRevisionId',
    'policyDigest',
    'issuedAt',
    'expiresAt',
  ]);
  if (
    value.schema !== PRIVACY_ACCESS_GRANT_SCHEMA ||
    value.policyRevisionId !== PRIVACY_ACCESS_POLICY_REVISION_ID ||
    value.policyDigest !== PRIVACY_ACCESS_POLICY_DIGEST
  ) {
    return invalid();
  }
  return Object.freeze({
    schema: PRIVACY_ACCESS_GRANT_SCHEMA,
    keyId: requireKeyId(value.keyId),
    grantId: requireUuidV4(value.grantId),
    decisionId: requireUuidV4(value.decisionId),
    workspaceId: requireUuidV4(value.workspaceId),
    actorId: requireUuidV4(value.actorId),
    purpose: requirePurpose(value.purpose),
    action: requireAction(value.action),
    resourceCategory: requireCategory(value.resourceCategory),
    accessMode: requireMode(value.accessMode),
    policyRevisionId: PRIVACY_ACCESS_POLICY_REVISION_ID,
    policyDigest: PRIVACY_ACCESS_POLICY_DIGEST,
    issuedAt: requireCanonicalTimestamp(value.issuedAt),
    expiresAt: requireCanonicalTimestamp(value.expiresAt),
  });
}

function verificationKey(
  keyRing: PrivacyGrantKeyRing,
  keyId: string,
): PrivacyGrantKey {
  const active = key(keyRing.active?.keyId, keyRing.active?.secret);
  if (keyId === active.keyId) {
    return active;
  }
  const previous = keyRing.previous;
  if (previous !== undefined) {
    const parsed = key(previous.keyId, previous.secret);
    if (keyId === parsed.keyId) {
      return parsed;
    }
  }
  return invalid();
}

function verifySignature(
  payload: string,
  signature: string,
  secret: string,
): void {
  if (!BASE64URL_PATTERN.test(signature)) {
    return invalid();
  }
  const expected = Buffer.from(sign(payload, secret), 'base64url');
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return invalid();
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    invalid();
  }
}

/**
 * Verifies one compact grant against an exact trusted actor/workspace context,
 * policy revision, validity window, and active/previous key selection.
 */
export function verifyPrivacyAccessGrantToken(
  token: string,
  keyRing: PrivacyGrantKeyRing,
  context: PrivacyGrantVerificationContext,
): PrivacyAccessGrantClaims {
  if (
    typeof token !== 'string' ||
    token.length === 0 ||
    token.length > MAXIMUM_TOKEN_CHARACTERS ||
    !context ||
    typeof context !== 'object'
  ) {
    return invalid();
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    return invalid();
  }
  const payload = parts[0] ?? '';
  const signature = parts[1] ?? '';
  const claims = parseClaims(decodePayload(payload));
  const selected = verificationKey(keyRing, claims.keyId);
  verifySignature(payload, signature, selected.secret);
  const workspaceId = requireUuidV4(context.workspaceId);
  const actorId = requireUuidV4(context.actorId);
  if (claims.workspaceId !== workspaceId || claims.actorId !== actorId) {
    return invalid();
  }
  if (!(context.now instanceof Date) || Number.isNaN(context.now.getTime())) {
    return invalid();
  }
  const now = context.now.getTime();
  const issued = Date.parse(claims.issuedAt);
  const expires = Date.parse(claims.expiresAt);
  const maximum =
    claims.accessMode === 'break_glass'
      ? MAXIMUM_BREAK_GLASS_TTL_MILLISECONDS
      : MAXIMUM_ORDINARY_TTL_MILLISECONDS;
  if (
    expires <= issued ||
    expires - issued > maximum ||
    issued - now > MAXIMUM_CLOCK_SKEW_MILLISECONDS ||
    now >= expires
  ) {
    return invalid();
  }
  return claims;
}
