import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PluginInstallationContext } from './plugin-installation';

/** UUIDv4 grammar accepted for tenant, user, and one-time evidence identities; values normalize to lowercase. */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Canonical unsigned decimal Unix-second grammar used by short-lived signed evidence. */
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
/** Canonical unpadded base64url grammar for exactly one SHA-256 HMAC digest. */
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
/** Exact lowercase installation item/revocation paths; case variants are never aliases. */
const INSTALLATION_ROUTE_PATTERN =
  /^\/v1\/plugins\/installations\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/revoke)?$/u;
/** Exact lowercase credential-revocation path; case variants are never aliases. */
const CREDENTIAL_ROUTE_PATTERN =
  /^\/v1\/plugins\/credential-bindings\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/revoke$/u;
/** Minimum UTF-8 verifier-key length required before any caller evidence is evaluated. */
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
/** Maximum age of otherwise valid operator evidence before it is classified invalid. */
export const PLUGIN_OPERATOR_CONTEXT_MAXIMUM_AGE_SECONDS = 60;
/** Maximum tolerated positive clock skew before future evidence is classified invalid. */
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
/** Exact installation collection path accepted only with POST. */
const INSTALLATION_COLLECTION_PATH = '/v1/plugins/installations';
/** Exact credential-binding collection path accepted only with POST. */
const CREDENTIAL_COLLECTION_PATH = '/v1/plugins/credential-bindings';

/** Untrusted signed identity forwarded by the authenticated Integration host. */
export interface IntegrationOperatorContextHeaders {
  readonly workspaceId: unknown;
  readonly userId: unknown;
  readonly evidenceId: unknown;
  readonly issuedAt: unknown;
  readonly signature: unknown;
}

/** Server-observed request identity included in operator-context verification. */
export interface IntegrationOperatorRequestBinding {
  readonly method: unknown;
  readonly path: unknown;
}

/** Verified authority plus the signed one-time evidence identity and issuance time. */
export interface VerifiedPluginOperatorContext {
  readonly trustedContext: PluginInstallationContext;
  readonly evidenceId: string;
  readonly issuedAtSeconds: number;
}

/** Fixed, credential-free operator-context rejection safe for HTTP classification. */
export class IntegrationOperatorContextError extends Error {
  /** Creates an invalid-authority or verifier-unavailable failure. */
  constructor(readonly kind: 'invalid' | 'unavailable') {
    super(
      kind === 'invalid'
        ? 'Plugin operator context is invalid'
        : 'Plugin operator context is unavailable',
    );
    this.name = 'IntegrationOperatorContextError';
  }
}

/** Classifies malformed, forged, stale, replayed-route, or unsupported caller evidence as invalid. */
function invalid(): never {
  throw new IntegrationOperatorContextError('invalid');
}

/** Classifies verifier configuration or clock state that cannot authenticate callers as unavailable. */
function unavailable(): never {
  throw new IntegrationOperatorContextError('unavailable');
}

/** Requires UUIDv4 identity evidence and returns its canonical lowercase representation. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

/**
 * Accepts only the implemented plugin operator method/path surface.
 *
 * Collection paths are exact constants. Dynamic UUID paths must already use the
 * canonical lowercase route grammar and are returned byte-for-byte so an HMAC for
 * a normalized alias can never authenticate a different received route.
 */
function requireOperatorRoute(
  binding: IntegrationOperatorRequestBinding,
): Readonly<{ method: 'GET' | 'POST'; path: string }> {
  if (
    binding.method === 'POST' &&
    binding.path === INSTALLATION_COLLECTION_PATH
  ) {
    return Object.freeze({
      method: 'POST',
      path: INSTALLATION_COLLECTION_PATH,
    });
  }
  if (
    binding.method === 'POST' &&
    binding.path === CREDENTIAL_COLLECTION_PATH
  ) {
    return Object.freeze({
      method: 'POST',
      path: CREDENTIAL_COLLECTION_PATH,
    });
  }
  if (
    typeof binding.path === 'string' &&
    INSTALLATION_ROUTE_PATTERN.test(binding.path)
  ) {
    const isRevocation = binding.path.endsWith('/revoke');
    if (
      (isRevocation && binding.method === 'POST') ||
      (!isRevocation && binding.method === 'GET')
    ) {
      return Object.freeze({
        method: binding.method,
        path: binding.path,
      });
    }
  }
  if (
    binding.method === 'POST' &&
    typeof binding.path === 'string' &&
    CREDENTIAL_ROUTE_PATTERN.test(binding.path)
  ) {
    return Object.freeze({
      method: 'POST',
      path: binding.path,
    });
  }
  return invalid();
}

/**
 * Verifies tenant-and-user authority and one-time evidence bound to one exact request.
 *
 * The signed UUIDv4 evidence identifier makes otherwise identical same-second
 * requests distinguishable without trusting caller-selected tenant or user data.
 * This verifier remains stateless; its caller must atomically consume the returned
 * evidence identifier before any downstream authority is invoked.
 */
export function requireVerifiedPluginOperatorContext(
  headers: IntegrationOperatorContextHeaders,
  secretValue: unknown,
  requestBinding: IntegrationOperatorRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedPluginOperatorContext {
  if (
    typeof secretValue !== 'string' ||
    Buffer.byteLength(secretValue, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return unavailable();
  }

  const binding = requireOperatorRoute(requestBinding);
  if (
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature)
  ) {
    return invalid();
  }
  const workspaceId = requireUuidV4(headers.workspaceId);
  const actorUserId = requireUuidV4(headers.userId);
  const evidenceId = requireUuidV4(headers.evidenceId);
  const issuedAtSeconds = Number(headers.issuedAt);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - PLUGIN_OPERATOR_CONTEXT_MAXIMUM_AGE_SECONDS
  ) {
    return invalid();
  }

  const actual = Buffer.from(headers.signature, 'base64url');
  if (actual.toString('base64url') !== headers.signature) {
    return invalid();
  }
  const expected = createHmac('sha256', secretValue)
    .update(
      `life-os.integration-operator-context.v1\n${workspaceId}\n${actorUserId}\n${evidenceId}\n${headers.issuedAt}\n${binding.method}\n${binding.path}`,
      'utf8',
    )
    .digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return invalid();
  }
  return Object.freeze({
    trustedContext: Object.freeze({ workspaceId, actorUserId }),
    evidenceId,
    issuedAtSeconds,
  });
}

/**
 * Returns trusted tenant/user authority for callers that do not need replay metadata.
 *
 * This compatibility verifier does not consume evidence. Security-sensitive
 * application boundaries must use `requireVerifiedPluginOperatorContext` and a
 * service-owned replay guard before granting downstream authority.
 */
export function requireTrustedPluginOperatorContext(
  headers: IntegrationOperatorContextHeaders,
  secretValue: unknown,
  requestBinding: IntegrationOperatorRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): PluginInstallationContext {
  return requireVerifiedPluginOperatorContext(
    headers,
    secretValue,
    requestBinding,
    nowSeconds,
  ).trustedContext;
}
