import { createHash } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTRIBUTOR_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9-]*)+$/;
const SCHEMA_VERSION_PATTERN = /^[a-z][a-z0-9.-]{2,99}$/;
const FORBIDDEN_EXPORT_KEY_PATTERN =
  /(password|secret|token|credential|private.?key|authorization|cookie)/i;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAXIMUM_CONTRIBUTORS = 32;
const MAXIMUM_SECTION_BYTES = 1024 * 1024;
const MAXIMUM_EXPORT_BYTES = 8 * 1024 * 1024;
const MAXIMUM_JSON_DEPTH = 20;
const MAXIMUM_ARRAY_ITEMS = 10_000;
const MAXIMUM_OBJECT_KEYS = 10_000;
const MAXIMUM_STRING_LENGTH = 100_000;
const MAXIMUM_BLOCKERS = 20;
const MAXIMUM_BLOCKER_LENGTH = 500;

export type JsonPrimitive = boolean | number | string | null;
export interface JsonArray extends ReadonlyArray<JsonValue> {}
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

export interface DataRightsWorkspaceContext {
  readonly workspaceId: string;
  readonly actorUserId: string;
}

export interface DataExportSection {
  readonly schemaVersion: string;
  readonly data: JsonValue;
}

export interface ErasurePreflight {
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

export interface ErasureContributorReceipt {
  readonly erasedRecords: number;
}

export interface DataRightsContributor {
  readonly name: string;
  exportWorkspace(
    context: DataRightsWorkspaceContext,
  ): Promise<DataExportSection>;
  preflightErase(
    context: DataRightsWorkspaceContext,
  ): Promise<ErasurePreflight>;
  eraseWorkspace(
    context: DataRightsWorkspaceContext & { readonly idempotencyKey: string },
  ): Promise<ErasureContributorReceipt>;
  verifyWorkspaceErased(
    context: DataRightsWorkspaceContext,
  ): Promise<boolean>;
}

export interface WorkspaceDataExport {
  readonly schemaVersion: 'life-os.data-export.v1';
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly generatedAt: string;
  readonly sections: readonly {
    readonly contributor: string;
    readonly schemaVersion: string;
    readonly data: JsonValue;
  }[];
  readonly sha256: string;
}

export interface WorkspaceErasureReceipt {
  readonly schemaVersion: 'life-os.data-erasure-receipt.v1';
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly idempotencyKey: string;
  readonly completedAt: string;
  readonly contributors: readonly {
    readonly contributor: string;
    readonly erasedRecords: number;
  }[];
  readonly sha256: string;
}

export class DataRightsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataRightsValidationError';
  }
}

export class ErasureBlockedError extends Error {
  constructor(
    readonly blockers: Readonly<Record<string, readonly string[]>>,
  ) {
    super('Workspace erasure is blocked');
    this.name = 'ErasureBlockedError';
  }
}

export class ErasureExecutionError extends Error {
  constructor(readonly completedContributors: readonly string[]) {
    super('Workspace erasure did not complete');
    this.name = 'ErasureExecutionError';
  }
}

export class ErasureVerificationError extends Error {
  constructor(readonly contributors: readonly string[]) {
    super('Workspace erasure could not be verified');
    this.name = 'ErasureVerificationError';
  }
}

function requireUuidV4(value: string, field: string): string {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new DataRightsValidationError(`${field} must be a UUIDv4`);
  }
  return value.toLowerCase();
}

function requireContributorName(value: string): string {
  if (!CONTRIBUTOR_NAME_PATTERN.test(value) || value.length > 100) {
    throw new DataRightsValidationError('Contributor name is invalid');
  }
  return value;
}

function requireSchemaVersion(value: string): string {
  if (!SCHEMA_VERSION_PATTERN.test(value)) {
    throw new DataRightsValidationError('Export schema version is invalid');
  }
  return value;
}

function requireIsoInstant(value: Date, field: string): string {
  if (!Number.isFinite(value.getTime())) {
    throw new DataRightsValidationError(`${field} is invalid`);
  }
  return value.toISOString();
}

function requirePlainObject(
  value: object,
): value is Readonly<Record<string, unknown>> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJson(value: unknown, depth = 0): JsonValue {
  if (depth > MAXIMUM_JSON_DEPTH) {
    throw new DataRightsValidationError('Export JSON is too deeply nested');
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DataRightsValidationError('Export JSON contains a non-finite number');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAXIMUM_STRING_LENGTH) {
      throw new DataRightsValidationError('Export JSON contains an oversized string');
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAXIMUM_ARRAY_ITEMS) {
      throw new DataRightsValidationError('Export JSON contains an oversized array');
    }
    return Object.freeze(value.map((item) => normalizeJson(item, depth + 1)));
  }
  if (typeof value !== 'object' || !requirePlainObject(value)) {
    throw new DataRightsValidationError('Export data must be JSON-compatible');
  }

  const entries = Object.entries(value);
  if (entries.length > MAXIMUM_OBJECT_KEYS) {
    throw new DataRightsValidationError('Export JSON contains too many object keys');
  }
  const normalized: Record<string, JsonValue> = Object.create(null) as Record<
    string,
    JsonValue
  >;
  for (const [key, entryValue] of entries.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (
      !key ||
      key.length > 200 ||
      FORBIDDEN_OBJECT_KEYS.has(key) ||
      FORBIDDEN_EXPORT_KEY_PATTERN.test(key)
    ) {
      throw new DataRightsValidationError('Export JSON contains a forbidden key');
    }
    normalized[key] = normalizeJson(entryValue, depth + 1);
  }
  return Object.freeze(normalized);
}

function canonicalJson(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(',')}}`;
}

function digest(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function requireBoundedSection(
  contributor: string,
  section: DataExportSection,
): {
  readonly contributor: string;
  readonly schemaVersion: string;
  readonly data: JsonValue;
  readonly bytes: number;
} {
  if (!section || typeof section !== 'object') {
    throw new DataRightsValidationError('Export section is invalid');
  }
  const schemaVersion = requireSchemaVersion(section.schemaVersion);
  const data = normalizeJson(section.data);
  const bytes = Buffer.byteLength(canonicalJson(data), 'utf8');
  if (bytes > MAXIMUM_SECTION_BYTES) {
    throw new DataRightsValidationError('Export section exceeds the size limit');
  }
  return Object.freeze({ contributor, schemaVersion, data, bytes });
}

function requirePreflight(value: ErasurePreflight): ErasurePreflight {
  if (!value || typeof value !== 'object' || typeof value.ready !== 'boolean') {
    throw new DataRightsValidationError('Erasure preflight is invalid');
  }
  if (!Array.isArray(value.blockers) || value.blockers.length > MAXIMUM_BLOCKERS) {
    throw new DataRightsValidationError('Erasure preflight blockers are invalid');
  }
  const blockers = value.blockers.map((blocker) => {
    if (
      typeof blocker !== 'string' ||
      !blocker.trim() ||
      blocker.length > MAXIMUM_BLOCKER_LENGTH
    ) {
      throw new DataRightsValidationError('Erasure preflight blocker is invalid');
    }
    return blocker.trim();
  });
  if (value.ready === (blockers.length > 0)) {
    throw new DataRightsValidationError('Erasure preflight is inconsistent');
  }
  return Object.freeze({ ready: value.ready, blockers: Object.freeze(blockers) });
}

function requireErasureReceipt(
  value: ErasureContributorReceipt,
): ErasureContributorReceipt {
  if (
    !value ||
    typeof value !== 'object' ||
    !Number.isSafeInteger(value.erasedRecords) ||
    value.erasedRecords < 0
  ) {
    throw new DataRightsValidationError('Erasure receipt is invalid');
  }
  return Object.freeze({ erasedRecords: value.erasedRecords });
}

function toJsonRecord(value: Record<string, unknown>): JsonValue {
  return normalizeJson(value);
}

/**
 * Coordinates tenant-complete exports and fail-closed erasure across bounded
 * service contributors without accepting ownership claims from request data.
 */
export class DataRightsApplication {
  private readonly contributors: readonly DataRightsContributor[];

  constructor(
    contributors: readonly DataRightsContributor[],
    private readonly now: () => Date = () => new Date(),
  ) {
    if (
      contributors.length === 0 ||
      contributors.length > MAXIMUM_CONTRIBUTORS
    ) {
      throw new DataRightsValidationError('Contributor count is invalid');
    }
    const names = new Set<string>();
    this.contributors = Object.freeze(
      contributors
        .map((contributor) => {
          const name = requireContributorName(contributor.name);
          if (names.has(name)) {
            throw new DataRightsValidationError('Contributor names must be unique');
          }
          names.add(name);
          return contributor;
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  }

  async exportWorkspace(
    trustedContext: DataRightsWorkspaceContext,
  ): Promise<WorkspaceDataExport> {
    const context = Object.freeze({
      workspaceId: requireUuidV4(trustedContext.workspaceId, 'workspaceId'),
      actorUserId: requireUuidV4(trustedContext.actorUserId, 'actorUserId'),
    });
    const generatedAt = requireIsoInstant(this.now(), 'Export clock');
    const sections: {
      contributor: string;
      schemaVersion: string;
      data: JsonValue;
    }[] = [];
    let totalBytes = 0;

    for (const contributor of this.contributors) {
      const section = requireBoundedSection(
        contributor.name,
        await contributor.exportWorkspace(context),
      );
      totalBytes += section.bytes;
      if (totalBytes > MAXIMUM_EXPORT_BYTES) {
        throw new DataRightsValidationError('Workspace export exceeds the size limit');
      }
      sections.push({
        contributor: section.contributor,
        schemaVersion: section.schemaVersion,
        data: section.data,
      });
    }

    const payload = toJsonRecord({
      schemaVersion: 'life-os.data-export.v1',
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      generatedAt,
      sections,
    });
    return Object.freeze({
      schemaVersion: 'life-os.data-export.v1',
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      generatedAt,
      sections: Object.freeze(sections.map((section) => Object.freeze(section))),
      sha256: digest(payload),
    });
  }

  async eraseWorkspace(input: {
    readonly trustedContext: DataRightsWorkspaceContext;
    readonly idempotencyKey: string;
    readonly confirmation: string;
  }): Promise<WorkspaceErasureReceipt> {
    const context = Object.freeze({
      workspaceId: requireUuidV4(
        input.trustedContext.workspaceId,
        'workspaceId',
      ),
      actorUserId: requireUuidV4(
        input.trustedContext.actorUserId,
        'actorUserId',
      ),
    });
    const idempotencyKey = requireUuidV4(
      input.idempotencyKey,
      'idempotencyKey',
    );
    if (input.confirmation !== 'erase-all-workspace-data') {
      throw new DataRightsValidationError('Explicit erasure confirmation is required');
    }

    const blockers: Record<string, readonly string[]> = Object.create(null) as Record<
      string,
      readonly string[]
    >;
    for (const contributor of this.contributors) {
      const preflight = requirePreflight(
        await contributor.preflightErase(context),
      );
      if (!preflight.ready) {
        blockers[contributor.name] = preflight.blockers;
      }
    }
    if (Object.keys(blockers).length > 0) {
      throw new ErasureBlockedError(Object.freeze(blockers));
    }

    const completedContributors: string[] = [];
    const receipts: { contributor: string; erasedRecords: number }[] = [];
    for (const contributor of this.contributors) {
      try {
        const receipt = requireErasureReceipt(
          await contributor.eraseWorkspace(
            Object.freeze({ ...context, idempotencyKey }),
          ),
        );
        completedContributors.push(contributor.name);
        receipts.push({
          contributor: contributor.name,
          erasedRecords: receipt.erasedRecords,
        });
      } catch {
        throw new ErasureExecutionError(
          Object.freeze([...completedContributors]),
        );
      }
    }

    const failedVerification: string[] = [];
    for (const contributor of this.contributors) {
      if (!(await contributor.verifyWorkspaceErased(context))) {
        failedVerification.push(contributor.name);
      }
    }
    if (failedVerification.length > 0) {
      throw new ErasureVerificationError(
        Object.freeze([...failedVerification]),
      );
    }

    const completedAt = requireIsoInstant(this.now(), 'Erasure clock');
    const payload = toJsonRecord({
      schemaVersion: 'life-os.data-erasure-receipt.v1',
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      idempotencyKey,
      completedAt,
      contributors: receipts,
    });
    return Object.freeze({
      schemaVersion: 'life-os.data-erasure-receipt.v1',
      workspaceId: context.workspaceId,
      requestedByUserId: context.actorUserId,
      idempotencyKey,
      completedAt,
      contributors: Object.freeze(
        receipts.map((receipt) => Object.freeze(receipt)),
      ),
      sha256: digest(payload),
    });
  }
}
