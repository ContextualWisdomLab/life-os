import { createHash } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEMA_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,99}$/;
const MAXIMUM_DOMAIN_RECORDS = 10_000;
const MAXIMUM_JSON_DEPTH = 20;
const MAXIMUM_JSON_NODES = 100_000;
const MAXIMUM_STRING_LENGTH = 100_000;
const MAXIMUM_PREPARE_TOKEN_LENGTH = 1_000;

/** Every tenant-owned domain that must participate before export or deletion succeeds. */
export const REQUIRED_DATA_RIGHTS_DOMAINS = Object.freeze([
  'identity',
  'planning',
  'habit',
  'review',
  'ai_audit',
  'calendar',
  'notification',
] as const);

export type DataRightsDomain = (typeof REQUIRED_DATA_RIGHTS_DOMAINS)[number];
export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** Non-mutating preparation evidence returned before any erasure commit. */
export interface DeletionPreparation {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly token: string;
}

/** Idempotent erasure confirmation returned by one tenant-data participant. */
export interface DeletionConfirmation {
  readonly workspaceId: string;
  readonly requestId: string;
  readonly deletedRecordCount: number;
}

/** Complete participant contract; preparation must not erase user data. */
export interface DataRightsParticipant {
  readonly domain: DataRightsDomain;
  readonly schemaVersion: string;
  exportWorkspace(workspaceId: string): Promise<readonly unknown[]>;
  prepareDeletion(
    workspaceId: string,
    requestId: string,
  ): Promise<DeletionPreparation>;
  commitDeletion(
    preparation: DeletionPreparation,
  ): Promise<DeletionConfirmation>;
}

/** Deterministic export section for one required data domain. */
export interface DataExportSection {
  readonly domain: DataRightsDomain;
  readonly schemaVersion: string;
  readonly recordCount: number;
  readonly contentDigest: string;
  readonly records: readonly JsonValue[];
}

/** Portable, integrity-protected JSON export of every registered tenant domain. */
export interface DataExportBundle {
  readonly format: 'life-os-portable-data-v1';
  readonly workspaceId: string;
  readonly generatedAt: string;
  readonly sections: readonly DataExportSection[];
  readonly contentDigest: string;
}

/** One participant's final erasure result. */
export interface DomainDeletionResult {
  readonly domain: DataRightsDomain;
  readonly deletedRecordCount: number;
}

/** A receipt exists only after every required participant confirms erasure. */
export interface CompleteDeletionReceipt {
  readonly status: 'complete';
  readonly workspaceId: string;
  readonly requestId: string;
  readonly completedAt: string;
  readonly domains: readonly DomainDeletionResult[];
  readonly receiptDigest: string;
}

/** Non-completion result used when a commit requires operator reconciliation. */
export interface PendingDeletionResult {
  readonly status: 'pending_reconciliation';
  readonly workspaceId: string;
  readonly requestId: string;
  readonly committedDomains: readonly DataRightsDomain[];
  readonly pendingDomains: readonly DataRightsDomain[];
}

export type DeletionResult = CompleteDeletionReceipt | PendingDeletionResult;
export type DataRightsClock = () => Date;

/** Invalid request, participant evidence, or registry configuration. */
export class DataRightsValidationError extends Error {
  constructor() {
    super('Data rights input or participant evidence is invalid');
    this.name = 'DataRightsValidationError';
  }
}

/** One or more required participants could not complete an operation. */
export class DataRightsDependencyError extends Error {
  constructor() {
    super('A required data rights participant is unavailable');
    this.name = 'DataRightsDependencyError';
  }
}

/** One request identifier was reused for another tenant. */
export class DataRightsConflictError extends Error {
  constructor() {
    super('Data rights request identifier conflicts with an earlier request');
    this.name = 'DataRightsConflictError';
  }
}

function invalid(): never {
  throw new DataRightsValidationError();
}

function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /\u0000/.test(value)
  ) {
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

function requireTimestamp(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    return invalid();
  }
  return value.toISOString();
}

function requireSchemaVersion(value: unknown): string {
  const normalized = requireString(value, 100);
  if (!SCHEMA_VERSION_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireRecordCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid();
  }
  return value as number;
}

interface JsonBudget {
  nodes: number;
}

function validateJsonValue(
  value: unknown,
  depth: number,
  budget: JsonBudget,
): JsonValue {
  budget.nodes += 1;
  if (budget.nodes > MAXIMUM_JSON_NODES || depth > MAXIMUM_JSON_DEPTH) {
    return invalid();
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAXIMUM_STRING_LENGTH || /\u0000/.test(value)) {
      return invalid();
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return invalid();
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => validateJsonValue(item, depth + 1, budget)),
    );
  }
  if (typeof value !== 'object') {
    return invalid();
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid();
  }
  const source = value as Readonly<Record<string, unknown>>;
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(source).sort()) {
    if (!key || key.length > 200 || /[\u0000]/.test(key)) {
      return invalid();
    }
    result[key] = validateJsonValue(source[key], depth + 1, budget);
  }
  return Object.freeze(result);
}

/** Converts untrusted participant data into canonical, frozen JSON values. */
export function canonicalizeJson(value: unknown): JsonValue {
  return validateJsonValue(value, 0, { nodes: 0 });
}

function canonicalStringify(value: JsonValue): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalStringify(
          (value as JsonObject)[key] as JsonValue,
        )}`,
    )
    .join(',')}}`;
}

function digest(value: JsonValue): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function requireParticipantRegistry(
  participants: readonly DataRightsParticipant[],
): ReadonlyMap<DataRightsDomain, DataRightsParticipant> {
  const registry = new Map<DataRightsDomain, DataRightsParticipant>();
  for (const participant of participants) {
    if (!REQUIRED_DATA_RIGHTS_DOMAINS.includes(participant.domain)) {
      return invalid();
    }
    if (registry.has(participant.domain)) {
      return invalid();
    }
    requireSchemaVersion(participant.schemaVersion);
    registry.set(participant.domain, participant);
  }
  if (
    registry.size !== REQUIRED_DATA_RIGHTS_DOMAINS.length ||
    REQUIRED_DATA_RIGHTS_DOMAINS.some((domain) => !registry.has(domain))
  ) {
    return invalid();
  }
  return registry;
}

function validatePreparation(
  value: DeletionPreparation,
  workspaceId: string,
  requestId: string,
): DeletionPreparation {
  if (
    requireUuidV4(value.workspaceId) !== workspaceId ||
    requireUuidV4(value.requestId) !== requestId
  ) {
    return invalid();
  }
  return Object.freeze({
    workspaceId,
    requestId,
    token: requireString(value.token, MAXIMUM_PREPARE_TOKEN_LENGTH),
  });
}

function validateConfirmation(
  value: DeletionConfirmation,
  workspaceId: string,
  requestId: string,
): DeletionConfirmation {
  if (
    requireUuidV4(value.workspaceId) !== workspaceId ||
    requireUuidV4(value.requestId) !== requestId
  ) {
    return invalid();
  }
  return Object.freeze({
    workspaceId,
    requestId,
    deletedRecordCount: requireRecordCount(value.deletedRecordCount),
  });
}

/** Coordinates complete exports and fail-closed two-phase tenant deletion. */
export class DataRightsCoordinator {
  private readonly participants: ReadonlyMap<
    DataRightsDomain,
    DataRightsParticipant
  >;
  private readonly requestOwners = new Map<string, string>();
  private readonly deletionResults = new Map<string, DeletionResult>();
  private readonly inFlightDeletions = new Map<
    string,
    Promise<DeletionResult>
  >();

  constructor(
    participants: readonly DataRightsParticipant[],
    private readonly clock: DataRightsClock = () => new Date(),
  ) {
    this.participants = requireParticipantRegistry(participants);
  }

  /** Exports every required domain or fails without returning a partial bundle. */
  async exportWorkspace(workspaceIdValue: string): Promise<DataExportBundle> {
    const workspaceId = requireUuidV4(workspaceIdValue);
    let sections: DataExportSection[];
    try {
      sections = await Promise.all(
        REQUIRED_DATA_RIGHTS_DOMAINS.map(async (domain) => {
          const participant = this.participants.get(domain) ?? invalid();
          const records = await participant.exportWorkspace(workspaceId);
          if (
            !Array.isArray(records) ||
            records.length > MAXIMUM_DOMAIN_RECORDS
          ) {
            return invalid();
          }
          const canonicalRecords = records
            .map(canonicalizeJson)
            .sort((left, right) => {
              const leftValue = canonicalStringify(left);
              const rightValue = canonicalStringify(right);
              return leftValue < rightValue
                ? -1
                : leftValue > rightValue
                  ? 1
                  : 0;
            });
          const sectionContent = canonicalizeJson({
            domain,
            schemaVersion: requireSchemaVersion(participant.schemaVersion),
            records: canonicalRecords,
          });
          return Object.freeze({
            domain,
            schemaVersion: participant.schemaVersion,
            recordCount: canonicalRecords.length,
            contentDigest: digest(sectionContent),
            records: Object.freeze(canonicalRecords),
          });
        }),
      );
    } catch (error) {
      if (error instanceof DataRightsValidationError) {
        throw error;
      }
      throw new DataRightsDependencyError();
    }
    const exportContent = canonicalizeJson({
      format: 'life-os-portable-data-v1',
      workspaceId,
      sections: sections.map((section) => ({
        domain: section.domain,
        schemaVersion: section.schemaVersion,
        recordCount: section.recordCount,
        contentDigest: section.contentDigest,
        records: section.records,
      })),
    });
    return Object.freeze({
      format: 'life-os-portable-data-v1',
      workspaceId,
      generatedAt: requireTimestamp(this.clock()),
      sections: Object.freeze(sections),
      contentDigest: digest(exportContent),
    });
  }

  /** Deletes only after every domain prepares; exact replays return one result. */
  async deleteWorkspace(
    workspaceIdValue: string,
    requestIdValue: string,
  ): Promise<DeletionResult> {
    const workspaceId = requireUuidV4(workspaceIdValue);
    const requestId = requireUuidV4(requestIdValue);
    const owner = this.requestOwners.get(requestId);
    if (owner && owner !== workspaceId) {
      throw new DataRightsConflictError();
    }
    this.requestOwners.set(requestId, workspaceId);
    const existing = this.deletionResults.get(requestId);
    if (existing) {
      return existing;
    }
    const inFlight = this.inFlightDeletions.get(requestId);
    if (inFlight) {
      return await inFlight;
    }
    const operation = this.performDeletion(workspaceId, requestId);
    this.inFlightDeletions.set(requestId, operation);
    try {
      const result = await operation;
      this.deletionResults.set(requestId, result);
      return result;
    } finally {
      this.inFlightDeletions.delete(requestId);
    }
  }

  private async performDeletion(
    workspaceId: string,
    requestId: string,
  ): Promise<DeletionResult> {
    const preparations = new Map<DataRightsDomain, DeletionPreparation>();
    try {
      for (const domain of REQUIRED_DATA_RIGHTS_DOMAINS) {
        const participant = this.participants.get(domain) ?? invalid();
        const preparation = await participant.prepareDeletion(
          workspaceId,
          requestId,
        );
        preparations.set(
          domain,
          validatePreparation(preparation, workspaceId, requestId),
        );
      }
    } catch (error) {
      if (error instanceof DataRightsValidationError) {
        throw error;
      }
      throw new DataRightsDependencyError();
    }

    const committed: DomainDeletionResult[] = [];
    for (const domain of REQUIRED_DATA_RIGHTS_DOMAINS) {
      const participant = this.participants.get(domain) ?? invalid();
      const preparation = preparations.get(domain) ?? invalid();
      try {
        const confirmation = validateConfirmation(
          await participant.commitDeletion(preparation),
          workspaceId,
          requestId,
        );
        committed.push(
          Object.freeze({
            domain,
            deletedRecordCount: confirmation.deletedRecordCount,
          }),
        );
      } catch {
        const committedDomains = Object.freeze(
          committed.map((result) => result.domain),
        );
        const pendingDomains = Object.freeze(
          REQUIRED_DATA_RIGHTS_DOMAINS.filter(
            (candidate) => !committedDomains.includes(candidate),
          ),
        );
        return Object.freeze({
          status: 'pending_reconciliation',
          workspaceId,
          requestId,
          committedDomains,
          pendingDomains,
        });
      }
    }

    const completedAt = requireTimestamp(this.clock());
    const receiptContent = canonicalizeJson({
      status: 'complete',
      workspaceId,
      requestId,
      completedAt,
      domains: committed,
    });
    return Object.freeze({
      status: 'complete',
      workspaceId,
      requestId,
      completedAt,
      domains: Object.freeze(committed),
      receiptDigest: digest(receiptContent),
    });
  }
}
