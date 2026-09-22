import type { DataRightsJsonValue } from './data-rights.js';

/**
 * Explicit paginated export contract for contributors whose bounded export
 * cannot be represented as one v1 section without silent truncation.
 */
export const DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v2' as const;

/** Contributor-issued continuation authority bound to one stable export snapshot. */
export interface DataRightsContributorExportContinuation {
  readonly snapshotId: string;
  readonly cursor: string;
}

/**
 * Requests one bounded page from a stable contributor-owned export snapshot.
 * `null` starts a new snapshot; later requests must replay the exact snapshot
 * identity and opaque cursor returned by the contributor.
 */
export interface DataRightsContributorPaginatedExportRequest {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION;
  readonly operation: 'export';
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
  readonly continuation: DataRightsContributorExportContinuation | null;
}

/**
 * One bounded page of a stable export. `nextCursor: null` is the only terminal
 * representation; omission never means completion.
 */
export interface DataRightsContributorPaginatedExportResponse {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION;
  readonly operation: 'export';
  readonly contributor: string;
  readonly requestId: string;
  readonly schemaVersion: string;
  readonly snapshotId: string;
  readonly pageIndex: number;
  readonly recordCount: number;
  readonly sha256: string;
  readonly data: DataRightsJsonValue;
  readonly nextCursor: string | null;
}
