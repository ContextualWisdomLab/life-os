import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  type DataRightsContributorExportRequest,
} from './data-rights.js';
import {
  DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION,
  type DataRightsContributorPaginatedExportRequest,
  type DataRightsContributorPaginatedExportResponse,
} from './data-rights-pagination.js';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT_ID = 'snapshot-01';

/** V1 remains a one-section contract; pagination must not silently change its wire semantics. */
const v1Request: DataRightsContributorExportRequest = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  operation: 'export',
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
  // @ts-expect-error v1 cannot acquire continuation semantics in place.
  cursor: 'opaque-v2-cursor',
};

/** The first V2 request has no contributor-issued continuation authority yet. */
const firstPageRequest: DataRightsContributorPaginatedExportRequest = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION,
  operation: 'export',
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
  continuation: null,
};

/** Every later V2 request binds the opaque cursor to the exact stable export snapshot. */
const nextPageRequest: DataRightsContributorPaginatedExportRequest = {
  ...firstPageRequest,
  continuation: {
    snapshotId: SNAPSHOT_ID,
    cursor: 'opaque-v2-cursor',
  },
};

const unboundContinuationRequest: DataRightsContributorPaginatedExportRequest = {
  ...firstPageRequest,
  // @ts-expect-error a cursor without its contributor-issued snapshot identity is not authority.
  continuation: { cursor: 'opaque-v2-cursor' },
};

/** Every page carries stable snapshot identity, monotonic page position, and explicit terminal state. */
const pageResponse: DataRightsContributorPaginatedExportResponse = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION,
  operation: 'export',
  contributor: 'notification.service',
  requestId: REQUEST_ID,
  schemaVersion: 'notification.data-rights.v1',
  snapshotId: SNAPSHOT_ID,
  pageIndex: 0,
  recordCount: 1,
  sha256: 'a'.repeat(64),
  data: Object.freeze({ records: Object.freeze([]) }),
  nextCursor: 'opaque-v2-cursor',
};

// @ts-expect-error a page without snapshot identity cannot prove one coherent export.
const unboundPageResponse: DataRightsContributorPaginatedExportResponse = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION,
  operation: 'export',
  contributor: 'notification.service',
  requestId: REQUEST_ID,
  schemaVersion: 'notification.data-rights.v1',
  pageIndex: 0,
  recordCount: 1,
  sha256: 'b'.repeat(64),
  data: Object.freeze({ records: Object.freeze([]) }),
  nextCursor: null,
};

// @ts-expect-error terminal completeness must be explicit; omission cannot mean both more-pages and done.
const ambiguousTerminalResponse: DataRightsContributorPaginatedExportResponse = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION,
  operation: 'export',
  contributor: 'notification.service',
  requestId: REQUEST_ID,
  schemaVersion: 'notification.data-rights.v1',
  snapshotId: SNAPSHOT_ID,
  pageIndex: 1,
  recordCount: 0,
  sha256: 'c'.repeat(64),
  data: Object.freeze({ records: Object.freeze([]) }),
};

void v1Request;
void nextPageRequest;
void unboundContinuationRequest;
void pageResponse;
void unboundPageResponse;
void ambiguousTerminalResponse;
