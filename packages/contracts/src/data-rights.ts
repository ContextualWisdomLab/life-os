/** Versioned internal contract used by independently deployable data-rights contributors. */
export const DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;

/** JSON-safe primitive allowed in a bounded contributor export section. */
export type DataRightsJsonPrimitive = boolean | number | string | null;

/** JSON-safe array allowed in a bounded contributor export section. */
export interface DataRightsJsonArray extends ReadonlyArray<DataRightsJsonValue> {}

/** JSON-safe object allowed in a bounded contributor export section. */
export interface DataRightsJsonObject {
  readonly [key: string]: DataRightsJsonValue;
}

/** JSON-safe value exchanged across the contributor contract. */
export type DataRightsJsonValue =
  | DataRightsJsonPrimitive
  | DataRightsJsonArray
  | DataRightsJsonObject;

/** Operations exposed by one service-owned data-rights contributor. */
export type DataRightsContributorOperation =
  | 'export'
  | 'erase_preflight'
  | 'erase'
  | 'verify_erased';

interface DataRightsContributorRequestBase {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
}

/** Requests one deterministic bounded export page from the owning service. */
export interface DataRightsContributorExportRequest
  extends DataRightsContributorRequestBase {
  readonly operation: 'export';
  /** Opaque contributor-owned keyset cursor returned by the previous page. */
  readonly cursor?: string;
}

/** Requests fail-closed erasure readiness without mutating service-owned data. */
export interface DataRightsContributorErasePreflightRequest
  extends DataRightsContributorRequestBase {
  readonly operation: 'erase_preflight';
}

/** Requests one idempotent owning-service erasure using an opaque replay key. */
export interface DataRightsContributorEraseRequest
  extends DataRightsContributorRequestBase {
  readonly operation: 'erase';
  readonly idempotencyKey: string;
}

/** Requests post-erasure verification from the service that owns the data. */
export interface DataRightsContributorVerifyErasedRequest
  extends DataRightsContributorRequestBase {
  readonly operation: 'verify_erased';
}

/** Request union for the complete v1 contributor lifecycle. */
export type DataRightsContributorRequest =
  | DataRightsContributorExportRequest
  | DataRightsContributorErasePreflightRequest
  | DataRightsContributorEraseRequest
  | DataRightsContributorVerifyErasedRequest;

interface DataRightsContributorResponseBase {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION;
  readonly contributor: string;
  readonly requestId: string;
}

/** Deterministic service-owned export page plus exact digest evidence. */
export interface DataRightsContributorExportResponse
  extends DataRightsContributorResponseBase {
  readonly operation: 'export';
  readonly schemaVersion: string;
  readonly recordCount: number;
  readonly sha256: string;
  readonly data: DataRightsJsonValue;
  /** Opaque cursor proving another bounded page remains; absent on the final page. */
  readonly nextCursor?: string;
}

/** Readiness result that cannot claim ready while blockers remain. */
export interface DataRightsContributorErasePreflightResponse
  extends DataRightsContributorResponseBase {
  readonly operation: 'erase_preflight';
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

/** Owning-service erasure receipt with bounded aggregate count and digest. */
export interface DataRightsContributorEraseResponse
  extends DataRightsContributorResponseBase {
  readonly operation: 'erase';
  readonly erasedRecords: number;
  readonly receiptSha256: string;
}

/** Post-erasure verification evidence from the owning service. */
export interface DataRightsContributorVerifyErasedResponse
  extends DataRightsContributorResponseBase {
  readonly operation: 'verify_erased';
  readonly erased: boolean;
  readonly evidenceSha256: string;
}

/** Response union for the complete v1 contributor lifecycle. */
export type DataRightsContributorResponse =
  | DataRightsContributorExportResponse
  | DataRightsContributorErasePreflightResponse
  | DataRightsContributorEraseResponse
  | DataRightsContributorVerifyErasedResponse;
