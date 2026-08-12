import { describe, expect, it } from 'vitest';
import { createAiRuntime, type AiPool } from './ai-runtime';
import type { ProposalAuditSqlQueryResult } from './postgres-proposal-audit-repository';

const DATABASE_URL = ['postgresql:', '', 'db', 'life_os'].join('/');
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/** Minimal pool that returns an empty AI-owned export snapshot. */
function inertPool(): AiPool {
  return {
    async query<Row>(text: string): Promise<ProposalAuditSqlQueryResult<Row>> {
      if (text.includes('AS proposal_audit_records')) {
        return {
          rows: [
            {
              proposal_audit_records: [],
              proposal_decision_events: [],
            } as Row,
          ],
        };
      }
      return { rows: [] };
    },
    async end(): Promise<void> {},
  };
}

describe('AI data-rights runtime composition', () => {
  it('exposes a service-owned contributor through the production runtime', async () => {
    const runtime = createAiRuntime(
      { AI_DATABASE_URL: DATABASE_URL },
      () => inertPool(),
    );

    try {
      const response = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'export',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
      });

      expect(response).toMatchObject({
        contractVersion: 'life-os.data-rights-contributor.v1',
        contributor: 'ai.service',
        operation: 'export',
        requestId: REQUEST_ID,
        recordCount: 0,
      });
    } finally {
      await runtime.close();
    }
  });
});
