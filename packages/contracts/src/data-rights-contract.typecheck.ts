import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  type DataRightsContributorEraseRequest,
  type DataRightsContributorExportResponse,
  type DataRightsContributorRequest,
  type DataRightsContributorResponse,
} from './data-rights.js';

const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';

/** Compile-time proof that erase authority cannot omit its replay identity. */
const eraseRequest: DataRightsContributorEraseRequest = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  operation: 'erase',
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
};

/** Compile-time proof that every operation belongs to the versioned request union. */
const requestUnion: DataRightsContributorRequest = eraseRequest;

/** Compile-time proof that export evidence is contributor-owned and digest-bearing. */
const exportResponse: DataRightsContributorExportResponse = {
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  operation: 'export',
  contributor: 'planning.service',
  requestId: REQUEST_ID,
  schemaVersion: 'planning.data-rights.v1',
  recordCount: 1,
  sha256: 'a'.repeat(64),
  data: Object.freeze({
    goals: Object.freeze([
      Object.freeze({
        id: '55555555-5555-4555-8555-555555555555',
        title: 'Example goal',
      }),
    ]),
  }),
};

/** Compile-time proof that concrete evidence remains assignable to the response union. */
const responseUnion: DataRightsContributorResponse = exportResponse;

void requestUnion;
void responseUnion;
