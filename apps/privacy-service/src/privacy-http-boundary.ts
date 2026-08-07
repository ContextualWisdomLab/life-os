import { HttpException } from '@nestjs/common';
import { PrivacyAccessApplicationError } from './privacy-access-application';
import {
  PRIVACY_ACCESS_ACTIONS,
  PRIVACY_ACCESS_PURPOSES,
  PRIVACY_RESOURCE_CATEGORIES,
  type PrivacyAccessAction,
  type PrivacyAccessPurpose,
  type PrivacyResourceCategory,
} from './privacy-access-domain';
import {
  PrivacyServiceContextError,
  type PrivacyServiceContextHeaders,
} from './privacy-service-context';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const MAXIMUM_TOKEN_CHARACTERS = 16_384;
const MINIMUM_REASON_CHARACTERS = 20;
const MAXIMUM_REASON_CHARACTERS = 500;
const MAXIMUM_REASON_BYTES = 1_024;
const MAXIMUM_BREAK_GLASS_TTL_SECONDS = 300;
const MAXIMUM_ORDINARY_TTL_SECONDS = 900;
const MAXIMUM_REFERENCE_CHARACTERS = 256;
const MAXIMUM_REFERENCE_BYTES = 1_024;
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000a-\u001f\u007f]/u;
const CONTEXT_HEADER_NAMES = Object.freeze([
  'x-life-os-context-key-id',
  'x-life-os-workspace-id',
  'x-life-os-actor-id',
  'x-life-os-context-issued-at',
  'x-life-os-context-signature',
] as const);

/** Exact body accepted by the access-decision route after parsing. */
export interface ParsedPrivacyAccessDecisionBody {
  readonly purpose: PrivacyAccessPurpose;
  readonly action: PrivacyAccessAction;
  readonly resourceCategory: PrivacyResourceCategory;
  readonly requestedTtlSeconds: number;
  readonly reason?: string;
}

/** Exact body accepted by the grant-consumption route after parsing. */
export interface ParsedPrivacyAccessConsumeBody {
  readonly grantToken: string;
  readonly resourceReference?: string;
}

/** RFC 9457-compatible credential-free privacy problem details. */
export interface PrivacyProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly decisionId?: string;
}

/** Stable validation failure for malformed HTTP bodies or headers. */
export class PrivacyHttpValidationError extends Error {
  /** Creates one bounded validation failure without retaining request input. */
  constructor() {
    super('Privacy HTTP request is invalid');
    this.name = 'PrivacyHttpValidationError';
  }
}

function invalid(): never {
  throw new PrivacyHttpValidationError();
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : invalid();
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const actual = Object.keys(value);
  if (
    actual.some((name) => !allowed.includes(name)) ||
    required.some((name) => !actual.includes(name))
  ) {
    invalid();
  }
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

function boundedOptionalText(
  value: unknown,
  minimumCharacters: number,
  maximumCharacters: number,
  maximumBytes: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || DISALLOWED_CONTROL_PATTERN.test(value)) {
    return invalid();
  }
  const normalized = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ');
  const characters = [...normalized].length;
  if (
    characters < minimumCharacters ||
    characters > maximumCharacters ||
    Buffer.byteLength(normalized, 'utf8') > maximumBytes
  ) {
    return invalid();
  }
  return normalized;
}

/** Parses one exact purpose-bound decision body with no ownership fields. */
export function parsePrivacyAccessDecisionBody(
  value: unknown,
): ParsedPrivacyAccessDecisionBody {
  const body = record(value);
  requireExactKeys(
    body,
    [
      'purpose',
      'action',
      'resourceCategory',
      'requestedTtlSeconds',
      'reason',
    ],
    ['purpose', 'action', 'resourceCategory', 'requestedTtlSeconds'],
  );
  const purpose = requirePurpose(body.purpose);
  const maximumTtlSeconds =
    purpose === 'break_glass'
      ? MAXIMUM_BREAK_GLASS_TTL_SECONDS
      : MAXIMUM_ORDINARY_TTL_SECONDS;
  if (
    !Number.isSafeInteger(body.requestedTtlSeconds) ||
    (body.requestedTtlSeconds as number) < 30 ||
    (body.requestedTtlSeconds as number) > maximumTtlSeconds
  ) {
    return invalid();
  }
  const reason = boundedOptionalText(
    body.reason,
    MINIMUM_REASON_CHARACTERS,
    MAXIMUM_REASON_CHARACTERS,
    MAXIMUM_REASON_BYTES,
  );
  if (purpose !== 'workspace_operation' && reason === undefined) {
    return invalid();
  }
  return Object.freeze({
    purpose,
    action: requireAction(body.action),
    resourceCategory: requireCategory(body.resourceCategory),
    requestedTtlSeconds: body.requestedTtlSeconds as number,
    ...(reason === undefined ? {} : { reason }),
  });
}

/** Parses one exact token-consumption body without ownership fields. */
export function parsePrivacyAccessConsumeBody(
  value: unknown,
): ParsedPrivacyAccessConsumeBody {
  const body = record(value);
  requireExactKeys(
    body,
    ['grantToken', 'resourceReference'],
    ['grantToken'],
  );
  if (
    typeof body.grantToken !== 'string' ||
    body.grantToken.length === 0 ||
    body.grantToken.length > MAXIMUM_TOKEN_CHARACTERS ||
    !TOKEN_PATTERN.test(body.grantToken)
  ) {
    return invalid();
  }
  const resourceReference = boundedOptionalText(
    body.resourceReference,
    1,
    MAXIMUM_REFERENCE_CHARACTERS,
    MAXIMUM_REFERENCE_BYTES,
  );
  return Object.freeze({
    grantToken: body.grantToken,
    ...(resourceReference === undefined ? {} : { resourceReference }),
  });
}

/** Selects exactly the five trusted context headers from normal HTTP metadata. */
export function extractPrivacyServiceContextHeaders(
  value: Readonly<Record<string, unknown>>,
): PrivacyServiceContextHeaders {
  const headers = record(value);
  const selected: Record<string, string> = {};
  for (const requiredName of CONTEXT_HEADER_NAMES) {
    const matches = Object.entries(headers).filter(
      ([candidate]) => candidate.toLowerCase() === requiredName,
    );
    if (
      matches.length !== 1 ||
      typeof matches[0]?.[1] !== 'string' ||
      matches[0][1].length === 0
    ) {
      return invalid();
    }
    selected[requiredName] = matches[0][1];
  }
  return Object.freeze(
    selected as unknown as PrivacyServiceContextHeaders,
  );
}

function problemException(
  status: number,
  title: string,
  code: string,
  decisionId?: string,
): HttpException {
  const problem: PrivacyProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
    ...(decisionId === undefined ? {} : { decisionId }),
  };
  return new HttpException(problem, status);
}

/** Creates one bounded access-denied problem with an opaque audit receipt. */
export function deniedPrivacyDecisionException(
  decisionIdValue: string,
): HttpException {
  const decisionId = decisionIdValue.toLowerCase();
  if (!UUID_V4_PATTERN.test(decisionId)) {
    return invalid();
  }
  return problemException(
    403,
    'Privacy access is not permitted',
    'access_denied',
    decisionId,
  );
}

/** Maps all boundary and application failures to credential-free problems. */
export function toPrivacyHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  if (error instanceof PrivacyHttpValidationError) {
    return problemException(
      400,
      'Privacy access request is invalid',
      'invalid_request',
    );
  }
  if (error instanceof PrivacyServiceContextError) {
    return problemException(
      401,
      'Authentication is required',
      'authentication_required',
    );
  }
  if (error instanceof PrivacyAccessApplicationError) {
    return problemException(
      503,
      'Privacy access service is unavailable',
      'privacy_service_unavailable',
    );
  }
  return problemException(
    503,
    'Privacy access service is unavailable',
    'privacy_service_unavailable',
  );
}
