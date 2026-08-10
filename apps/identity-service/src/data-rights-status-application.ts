import type { SessionIntrospectionResponse } from './oauth-http-application';
import type {
  DataRightsRequestRecord,
  GetDataRightsRequest,
} from './data-rights-request-ledger';

interface SessionIntrospectionApplication {
  introspectSession(
    cookieHeader: string | undefined,
  ): Promise<SessionIntrospectionResponse>;
}

interface DataRightsRequestLookup {
  getRequest(
    input: GetDataRightsRequest,
  ): Promise<DataRightsRequestRecord | undefined>;
}

/** Credential-free public representation of one authenticated data-rights request. */
export interface DataRightsRequestStatusView {
  readonly schemaVersion: 'life-os.data-rights-request-status.v1';
  readonly requestId: string;
  readonly requestKind: DataRightsRequestRecord['requestKind'];
  readonly status: DataRightsRequestRecord['status'];
  readonly requestedAt: string;
  readonly completedAt: string | null;
}

/** Indistinguishable absence error for missing and inaccessible data-rights requests. */
export class DataRightsRequestNotFoundError extends Error {
  /** Creates a fixed not-found error without retaining the requested identifier. */
  constructor() {
    super('Data-rights request was not found');
    this.name = 'DataRightsRequestNotFoundError';
  }
}

/**
 * Resolves one durable data-rights request through authenticated tenant and actor
 * authority while exposing only the bounded public lifecycle projection.
 */
export class AuthenticatedDataRightsStatusApplication {
  constructor(
    private readonly sessions: SessionIntrospectionApplication,
    private readonly ledger: DataRightsRequestLookup,
  ) {}

  /** Returns the status of a request owned by the authenticated session. */
  async getRequestStatus(
    cookieHeader: string | undefined,
    requestId: string,
  ): Promise<DataRightsRequestStatusView> {
    const session = await this.sessions.introspectSession(cookieHeader);
    const request = await this.ledger.getRequest({
      requestId,
      workspaceId: session.body.workspaceId,
      requestedByUserId: session.body.userId,
    });
    if (!request) {
      throw new DataRightsRequestNotFoundError();
    }
    return Object.freeze({
      schemaVersion: 'life-os.data-rights-request-status.v1',
      requestId: request.requestId,
      requestKind: request.requestKind,
      status: request.status,
      requestedAt: request.requestedAt,
      completedAt: request.completedAt,
    });
  }
}
