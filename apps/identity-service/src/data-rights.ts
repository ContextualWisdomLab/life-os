import { createHash } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_ID_PATTERN = /^[a-z][a-z0-9.-]{1,63}$/;
const RECORD_KIND_PATTERN = /^[a-z][a-z0-9._-]{1,63}$/;
const SCHEMA_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_SOURCES = 64;
const MAXIMUM_RECORDS_PER_SOURCE = 10_000;
const MAXIMUM_TOTAL_RECORDS = 50_000;
const MAXIMUM_RECORD_BYTES = 64 * 1_024;
const MAXIMUM_EXPORT_BYTES = 4 * 1_024 * 1_024;
const MAXIMUM_JSON_DEPTH = 16;
const MAXIMUM_JSON_ARRAY_ITEMS = 10_000;
const MAXIMUM_JSON_OBJECT_KEYS = 1_000;
const MAXIMUM_JSON_STRING_LENGTH = 64 * 1_024;
const EXPORT_SCHEMA_VERSION = 'life-os.workspace-export.v1';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** One portable, tenant-owned record returned by a registered source. */
export interface WorkspaceDataRecord {
  readonly id: string;
  readonly kind: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}

/** Explicit source declaration used to determine whether erasure can proceed. */
export type ErasureDisposition =
  | { readonly mode: 'erase' }
  | {
      readonly mode: 'retain';
      readonly reason: string;
      readonly until?: string;
    };

/** Bounded output produced by one registered tenant-data source. */
export interface WorkspaceDataSourceSnapshot {
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly schemaVersion: string;
  readonly records: readonly WorkspaceDataRecord[];
  readonly erasure: ErasureDisposition;
}

/** Read-only source contract. It intentionally exposes no erasure operation. */
export interface WorkspaceDataRightsSource {
  readonly sourceId: string;
  inspectWorkspace(workspaceId: string): Promise<unknown>;
}

/** Portable export bundle with a canonical integrity digest. */
export interface WorkspaceDataExport {
  readonly schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly generatedAt: string;
  readonly sources: readonly WorkspaceDataSourceSnapshot[];
  readonly digest: string;
}

/** One source preventing a complete erasure operation. */
export interface ErasureReadinessBlocker {
  readonly sourceId: string;
  readonly reason: string;
  readonly until?: string;
}

/** Fail-closed readiness evidence produced before any destructive command. */
export interface WorkspaceErasureReadiness {
  readonly workspaceId: string;
  readonly evaluatedAt: string;
  readonly ready: boolean;
  readonly sourceIds: readonly string[];
  readonly blockers: readonly ErasureReadinessBlocker[];
  readonly digest: string;
}

/** Stable input or source-output validation failure. */
export class DataRightsValidationError extends Error {
  constructor() {
    super('Workspace data-rights evidence is invalid');
    this.name = 'DataRightsValidationError';
  }
}

/** Credential-free dependency failure from a registered source. */
export class DataRightsDependencyError extends Error {
  constructor() {
    super('Workspace data-rights source is unavailable');
    this.name = 'DataRightsDependencyError';
  }
}

interface MutableBudget {
  remainingBytes: number;
  remainingRecords: number;
}

function invalid(): never {
  throw new DataRightsValidationError();
}

function consumeBytes(budget: MutableBudget, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > budget.remainingBytes) {
    invalid();
  }
  budget.remainingBytes -= amount;
}

function consumeRecord(budget: MutableBudget, bytes: number): void {
  if (budget.remainingRecords <= 0) {
    invalid();
  }
  budget.remainingRecords -= 1;
  consumeBytes(budget, bytes);
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(record);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    invalid();
  }
}

function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    return invalid();
  }
  return normalized;
}

function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireSourceId(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!SOURCE_ID_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireRecordKind(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!RECORD_KIND_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireSchemaVersion(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!SCHEMA_VERSION_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireInstant(value: unknown): string {
  const normalized = requireString(value, 64);
  const instant = new Date(normalized);
  if (Number.isNaN(instant.getTime())) {
    return invalid();
  }
  return instant.toISOString();
}

function requireDigest(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function canonicalPrimitive(value: JsonPrimitive): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return invalid();
  }
  return serialized;
}

function normalizeJson(
  value: unknown,
  depth = 0,
  budget?: MutableBudget,
): JsonValue {
  if (depth > MAXIMUM_JSON_DEPTH) {
    return invalid();
  }
  if (value === null || typeof value === 'boolean') {
    if (budget) {
      consumeBytes(budget, Buffer.byteLength(canonicalPrimitive(value)));
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAXIMUM_JSON_STRING_LENGTH) {
      return invalid();
    }
    if (budget) {
      consumeBytes(budget, Buffer.byteLength(canonicalPrimitive(value)));
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return invalid();
    }
    if (budget) {
      consumeBytes(budget, Buffer.byteLength(canonicalPrimitive(value)));
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAXIMUM_JSON_ARRAY_ITEMS) {
      return invalid();
    }
    if (budget) {
      consumeBytes(budget, 2 + Math.max(0, value.length - 1));
    }
    return Object.freeze(
      value.map((item) => normalizeJson(item, depth + 1, budget)),
    );
  }
  const record = requireRecord(value);
  const keys = Object.keys(record).sort();
  if (keys.length > MAXIMUM_JSON_OBJECT_KEYS) {
    return invalid();
  }
  if (budget) {
    consumeBytes(budget, 2 + Math.max(0, keys.length - 1));
  }
  const normalized: Record<string, JsonValue> = {};
  for (const key of keys) {
    if (!key || key.length > 256) {
      return invalid();
    }
    if (budget) {
      consumeBytes(budget, Buffer.byteLength(JSON.stringify(key)) + 1);
    }
    normalized[key] = normalizeJson(record[key], depth + 1, budget);
  }
  return Object.freeze(normalized);
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return canonicalPrimitive(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key] as JsonValue)}`,
    )
    .join(',')}}`;
}

function digestJson(value: JsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function normalizeDataRecord(
  value: unknown,
  aggregateBudget?: MutableBudget,
): WorkspaceDataRecord {
  const record = requireRecord(value);
  requireExactKeys(record, ['id', 'kind', 'data']);
  const recordBudget: MutableBudget = {
    remainingBytes: MAXIMUM_RECORD_BYTES,
    remainingRecords: 1,
  };
  const data = normalizeJson(record.data, 0, recordBudget);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return invalid();
  }
  const normalized = Object.freeze({
    id: requireUuidV4(record.id),
    kind: requireRecordKind(record.kind),
    data: data as Readonly<Record<string, JsonValue>>,
  });
  const recordBytes = MAXIMUM_RECORD_BYTES - recordBudget.remainingBytes;
  if (aggregateBudget) {
    consumeRecord(aggregateBudget, recordBytes);
  }
  return normalized;
}

function normalizeErasureDisposition(value: unknown): ErasureDisposition {
  const record = requireRecord(value);
  if (record.mode === 'erase') {
    requireExactKeys(record, ['mode']);
    return Object.freeze({ mode: 'erase' });
  }
  if (record.mode !== 'retain') {
    return invalid();
  }
  requireExactKeys(record, ['mode', 'reason'], ['until']);
  const reason = requireString(record.reason, 1_000);
  if (!Object.hasOwn(record, 'until')) {
    return Object.freeze({ mode: 'retain', reason });
  }
  return Object.freeze({
    mode: 'retain',
    reason,
    until: requireInstant(record.until),
  });
}

function normalizeSourceSnapshot(
  value: unknown,
  expectedSourceId: string,
  expectedWorkspaceId: string,
  aggregateBudget?: MutableBudget,
): WorkspaceDataSourceSnapshot {
  const record = requireRecord(value);
  requireExactKeys(record, [
    'sourceId',
    'workspaceId',
    'schemaVersion',
    'records',
    'erasure',
  ]);
  const sourceId = requireSourceId(record.sourceId);
  const workspaceId = requireUuidV4(record.workspaceId);
  if (sourceId !== expectedSourceId || workspaceId !== expectedWorkspaceId) {
    return invalid();
  }
  if (!Array.isArray(record.records)) {
    return invalid();
  }
  if (record.records.length > MAXIMUM_RECORDS_PER_SOURCE) {
    return invalid();
  }
  const records = record.records
    .map((item) => normalizeDataRecord(item, aggregateBudget))
    .sort((left, right) => {
      const byKind = left.kind.localeCompare(right.kind);
      return byKind === 0 ? left.id.localeCompare(right.id) : byKind;
    });
  const identities = new Set<string>();
  for (const item of records) {
    const identity = `${item.kind}:${item.id}`;
    if (identities.has(identity)) {
      return invalid();
    }
    identities.add(identity);
  }
  return Object.freeze({
    sourceId,
    workspaceId,
    schemaVersion: requireSchemaVersion(record.schemaVersion),
    records: Object.freeze(records),
    erasure: normalizeErasureDisposition(record.erasure),
  });
}

function normalizeSource(source: WorkspaceDataRightsSource): WorkspaceDataRightsSource {
  const sourceId = requireSourceId(source.sourceId);
  if (typeof source.inspectWorkspace !== 'function') {
    return invalid();
  }
  return Object.freeze({
    sourceId,
    inspectWorkspace: source.inspectWorkspace.bind(source),
  });
}

function exportEvidence(
  workspaceId: string,
  generatedAt: string,
  sources: readonly WorkspaceDataSourceSnapshot[],
): JsonValue {
  return normalizeJson({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    workspaceId,
    generatedAt,
    sources,
  });
}

function readinessEvidence(
  workspaceId: string,
  evaluatedAt: string,
  sourceIds: readonly string[],
  blockers: readonly ErasureReadinessBlocker[],
): JsonValue {
  return normalizeJson({
    workspaceId,
    evaluatedAt,
    ready: blockers.length === 0,
    sourceIds,
    blockers,
  });
}

function requireBoundedSourceCollection(value: unknown): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_SOURCES
  ) {
    return invalid();
  }
  let totalRecords = 0;
  for (const source of value) {
    const sourceRecord = requireRecord(source);
    if (!Array.isArray(sourceRecord.records)) {
      return invalid();
    }
    totalRecords += sourceRecord.records.length;
    if (
      sourceRecord.records.length > MAXIMUM_RECORDS_PER_SOURCE ||
      totalRecords > MAXIMUM_TOTAL_RECORDS
    ) {
      return invalid();
    }
  }
  return value;
}

/**
 * Coordinates deterministic exports and erasure-readiness inspection without
 * exposing a destructive source capability.
 */
export class WorkspaceDataRightsCoordinator {
  private readonly sources: readonly WorkspaceDataRightsSource[];

  constructor(sources: readonly WorkspaceDataRightsSource[]) {
    if (sources.length === 0 || sources.length > MAXIMUM_SOURCES) {
      invalid();
    }
    const normalized = sources.map(normalizeSource);
    const identifiers = new Set<string>();
    for (const source of normalized) {
      if (identifiers.has(source.sourceId)) {
        invalid();
      }
      identifiers.add(source.sourceId);
    }
    this.sources = Object.freeze(
      normalized.sort((left, right) =>
        left.sourceId.localeCompare(right.sourceId),
      ),
    );
  }

  private async inspectSources(
    workspaceId: string,
  ): Promise<readonly WorkspaceDataSourceSnapshot[]> {
    const workspace = requireUuidV4(workspaceId);
    const aggregateBudget: MutableBudget = {
      remainingBytes: MAXIMUM_EXPORT_BYTES,
      remainingRecords: MAXIMUM_TOTAL_RECORDS,
    };
    const snapshots = await Promise.all(
      this.sources.map(async (source) => {
        let raw: unknown;
        try {
          raw = await source.inspectWorkspace(workspace);
        } catch {
          throw new DataRightsDependencyError();
        }
        return normalizeSourceSnapshot(
          raw,
          source.sourceId,
          workspace,
          aggregateBudget,
        );
      }),
    );
    return Object.freeze(snapshots);
  }

  async createExport(
    workspaceId: string,
    generatedAt: string = new Date().toISOString(),
  ): Promise<WorkspaceDataExport> {
    const workspace = requireUuidV4(workspaceId);
    const timestamp = requireInstant(generatedAt);
    const sources = await this.inspectSources(workspace);
    const evidence = exportEvidence(workspace, timestamp, sources);
    if (Buffer.byteLength(canonicalJson(evidence)) > MAXIMUM_EXPORT_BYTES) {
      return invalid();
    }
    return Object.freeze({
      schemaVersion: EXPORT_SCHEMA_VERSION,
      workspaceId: workspace,
      generatedAt: timestamp,
      sources,
      digest: digestJson(evidence),
    });
  }

  async evaluateErasureReadiness(
    workspaceId: string,
    evaluatedAt: string = new Date().toISOString(),
  ): Promise<WorkspaceErasureReadiness> {
    const workspace = requireUuidV4(workspaceId);
    const timestamp = requireInstant(evaluatedAt);
    const snapshots = await this.inspectSources(workspace);
    const sourceIds = Object.freeze(snapshots.map((source) => source.sourceId));
    const blockers = Object.freeze(
      snapshots.flatMap<ErasureReadinessBlocker>((source) => {
        if (source.erasure.mode === 'erase') {
          return [];
        }
        const base = {
          sourceId: source.sourceId,
          reason: source.erasure.reason,
        } as const;
        return [
          source.erasure.until === undefined
            ? Object.freeze(base)
            : Object.freeze({ ...base, until: source.erasure.until }),
        ];
      }),
    );
    const evidence = readinessEvidence(workspace, timestamp, sourceIds, blockers);
    return Object.freeze({
      workspaceId: workspace,
      evaluatedAt: timestamp,
      ready: blockers.length === 0,
      sourceIds,
      blockers,
      digest: digestJson(evidence),
    });
  }
}

/** Validates an export and returns a normalized immutable copy. */
export function verifyWorkspaceDataExport(value: unknown): WorkspaceDataExport {
  const record = requireRecord(value);
  requireExactKeys(record, [
    'schemaVersion',
    'workspaceId',
    'generatedAt',
    'sources',
    'digest',
  ]);
  if (record.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return invalid();
  }
  const workspaceId = requireUuidV4(record.workspaceId);
  const generatedAt = requireInstant(record.generatedAt);
  const rawSources = requireBoundedSourceCollection(record.sources);
  const aggregateBudget: MutableBudget = {
    remainingBytes: MAXIMUM_EXPORT_BYTES,
    remainingRecords: MAXIMUM_TOTAL_RECORDS,
  };
  const sources = rawSources
    .map((source) => {
      const sourceRecord = requireRecord(source);
      return normalizeSourceSnapshot(
        sourceRecord,
        requireSourceId(sourceRecord.sourceId),
        workspaceId,
        aggregateBudget,
      );
    })
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (sourceIds.has(source.sourceId)) {
      return invalid();
    }
    sourceIds.add(source.sourceId);
  }
  const evidence = exportEvidence(workspaceId, generatedAt, sources);
  if (Buffer.byteLength(canonicalJson(evidence)) > MAXIMUM_EXPORT_BYTES) {
    return invalid();
  }
  const digest = requireDigest(record.digest);
  if (digestJson(evidence) !== digest) {
    return invalid();
  }
  return Object.freeze({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    workspaceId,
    generatedAt,
    sources: Object.freeze(sources),
    digest,
  });
}
