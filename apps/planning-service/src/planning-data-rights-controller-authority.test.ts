import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningDataRightsController } from './main';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  type DataRightsContributorResponse,
} from './planning-data-rights';
import type { PlanningRuntime } from './planning-runtime';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SECRET = randomBytes(32).toString('base64url');
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';

const request = Object.freeze({
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  operation: 'export' as const,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
});

/** Signs one exact Planning contributor request at the supplied Unix second. */
function signature(issuedAt: string): string {
  return createHmac('sha256', SECRET)
    .update(
      [
        'life-os.planning-data-rights-context.v1',
        request.contractVersion,
        request.workspaceId,
        request.requestedByUserId,
        request.requestId,
        request.operation,
        '-',
        issuedAt,
        'POST',
        CONTRIBUTOR_PATH,
      ].join('\n'),
      'utf8',
    )
    .digest('base64url');
}

/** Creates the smallest runtime-shaped collaborator observable by the controller. */
function controllerWith(handle: ReturnType<typeof vi.fn>): PlanningDataRightsController {
  const runtime = {
    dataRightsContributor: { handle },
  } as unknown as PlanningRuntime;
  return new PlanningDataRightsController(runtime);
}

afterEach(() => {
  delete process.env.PLANNING_DATA_RIGHTS_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe('Planning data-rights controller authority', () => {
  it('passes only a verified normalized request to the owning contributor', async () => {
    process.env.PLANNING_DATA_RIGHTS_CONTEXT_SECRET = SECRET;
    const response: DataRightsContributorResponse = {
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      contributor: 'planning.service',
      requestId: REQUEST_ID,
      operation: 'erase_preflight',
      ready: true,
      blockers: [],
    };
    const handle = vi.fn().mockResolvedValue(response);
    const controller = controllerWith(handle);
    const issuedAt = String(Math.floor(Date.now() / 1000));

    await expect(
      controller.contribute(issuedAt, signature(issuedAt), request),
    ).resolves.toEqual(response);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(request);
  });

  it('rejects forged authority before the contributor can observe a request', async () => {
    process.env.PLANNING_DATA_RIGHTS_CONTEXT_SECRET = SECRET;
    const handle = vi.fn();
    const controller = controllerWith(handle);
    const issuedAt = String(Math.floor(Date.now() / 1000));

    await expect(
      controller.contribute(issuedAt, 'A'.repeat(43), request),
    ).rejects.toMatchObject({ status: 401 });
    expect(handle).not.toHaveBeenCalled();
  });

  it('fails closed when the service verifier is not configured', async () => {
    const handle = vi.fn();
    const controller = controllerWith(handle);
    const issuedAt = String(Math.floor(Date.now() / 1000));

    await expect(
      controller.contribute(issuedAt, signature(issuedAt), request),
    ).rejects.toMatchObject({ status: 503 });
    expect(handle).not.toHaveBeenCalled();
  });
});
