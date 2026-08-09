import type { DataRightsWorkspaceContext } from './data-rights';
import { requireRecentAuthentication } from './oauth-http-boundary';

interface SessionView {
  readonly userId: string;
  readonly workspaceId: string;
  readonly authenticatedAt: string;
}

interface SessionIntrospectionApplication {
  introspectSession(cookieHeader: string | undefined): Promise<{
    readonly statusCode: number;
    readonly body: SessionView;
  }>;
}

interface DataRightsExportApplication {
  exportWorkspace(context: DataRightsWorkspaceContext): Promise<unknown>;
}

interface RecentAuthenticationOptions {
  readonly now: () => Date;
  readonly maximumAgeMs: number;
}

/**
 * Establishes the authenticated application boundary for data-rights exports.
 * Workspace and actor ownership are derived exclusively from the opaque session,
 * and the request is rejected before data-rights work when authentication is stale.
 */
export class AuthenticatedDataRightsApplication {
  constructor(
    private readonly sessions: SessionIntrospectionApplication,
    private readonly dataRights: DataRightsExportApplication,
    private readonly options: RecentAuthenticationOptions,
  ) {}

  /**
   * Exports the session-owned workspace after enforcing the configured recent-authentication window.
   */
  async exportWorkspace(cookieHeader: string | undefined): Promise<unknown> {
    const session = await this.sessions.introspectSession(cookieHeader);
    if (session.statusCode !== 200) {
      throw new Error('Authentication is required');
    }
    requireRecentAuthentication({
      authenticatedAt: session.body.authenticatedAt,
      now: this.options.now(),
      maximumAgeMs: this.options.maximumAgeMs,
    });
    return this.dataRights.exportWorkspace(
      Object.freeze({
        workspaceId: session.body.workspaceId,
        actorUserId: session.body.userId,
      }),
    );
  }
}
