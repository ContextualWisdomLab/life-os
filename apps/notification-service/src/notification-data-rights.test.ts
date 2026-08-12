import { describe, expect, it } from 'vitest';
import {
  createNotificationRuntime,
  type NotificationPool,
  type NotificationRuntime,
} from './notification-runtime';

const TEST_DATABASE_URL = [
  'postgresql:',
  '',
  '127.0.0.1',
  'notification_test',
].join('/');
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/** Minimal credential-free pool used only to inspect runtime composition. */
function inertPool(): NotificationPool {
  return {
    async query<Row>(): Promise<{ rows: Row[] }> {
      return { rows: [] };
    },
    async end(): Promise<void> {},
  };
}

describe('Notification data-rights runtime composition', () => {
  it('exposes a service-owned contributor through the production runtime', async () => {
    const runtime = createNotificationRuntime(
      { NOTIFICATION_DATABASE_URL: TEST_DATABASE_URL },
      () => inertPool(),
    ) as NotificationRuntime & {
      readonly dataRightsContributor?: {
        handle(request: unknown): Promise<unknown>;
      };
    };

    try {
      const contributor = runtime.dataRightsContributor;
      expect(contributor).toBeDefined();
      if (!contributor) {
        throw new Error(
          'Notification runtime did not compose its data-rights contributor',
        );
      }

      const response = await contributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'export',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
      });

      expect(response).toMatchObject({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'export',
        contributor: 'notification.service',
        requestId: REQUEST_ID,
        recordCount: 0,
      });
    } finally {
      await runtime.close();
    }
  });
});
