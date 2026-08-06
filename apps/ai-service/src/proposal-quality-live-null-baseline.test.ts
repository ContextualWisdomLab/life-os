import { describe, expect, it, vi } from 'vitest';
import type { ContextualOrchestratorFetch } from './contextual-orchestrator-proposal-model';
import {
  runProposalLiveConformance,
  type ProposalLiveCompletedProfile,
} from './proposal-quality-live-conformance';

const TOKEN = Buffer.alloc(32, 0x5a).toString('base64url');

/** Returns a deterministic increasing monotonic clock. */
function monotonicClock(): () => number {
  let value = 0;
  return () => {
    value += 1;
    return value;
  };
}

describe('live conformance null baseline evidence', () => {
  it('preserves undefined rate denominators when every baseline call fails', async () => {
    const fetcher = vi.fn<ContextualOrchestratorFetch>(
      async () => new Response('private upstream response', { status: 503 }),
    );
    const report = await runProposalLiveConformance({
      lifeOsCommitSha: 'a'.repeat(40),
      contextualOrchestratorCommitSha: 'b'.repeat(40),
      modelInventory: ['meta/live-model'],
      evaluatedAt: new Date('2026-08-06T09:00:00.000Z'),
      providerCredentialAvailable: true,
      environment: {
        CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
        CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
      },
      fetcher,
      monotonicClock: monotonicClock(),
    });

    const baseline = report.profiles.find(
      (profile) => profile.profileId === 'route_high',
    ) as ProposalLiveCompletedProfile | undefined;
    expect(baseline?.status).toBe('completed_with_failures');
    expect(Object.values(baseline?.rateDeltasFromBaseline ?? {})).toContain(
      null,
    );
    expect(fetcher).toHaveBeenCalledTimes(21);
  });
});
