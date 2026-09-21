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

/** V2 makes continuation authority explicit for bounded multi-page export. */
const firstPageRequest: DataRightsContributorPaginatedExportRequest = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION,
  operation: 'export',
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
};

/** A subsequent V2 request carries only the opaque contributor-owned continuation token. */
const nextPageRequest: DataRightsContributorPaginatedExportRequest = {
  ...firstPageRequest,
  cursor: 'opaque-v2-cursor',
};

/** V2 response exposes continuation explicitly without weakening bounded page evidence. */
const pageResponse: DataRightsContributorPaginatedExportResponse = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_PAGINATED_CONTRACT_VERSION,
  operation: 'export',
  contributor: 'notification.service',
  requestId: REQUEST_ID,
  schemaVersion: 'notification.data-rights.v1',
  recordCount: 1,
  sha256: 'a'.repeat(64),
  data: Object.freeze({ records: Object.freeze([]) }),
  nextCursor: 'opaque-v2-cursor',
};

void v1Request;
void nextPageRequest;
void pageResponse;
