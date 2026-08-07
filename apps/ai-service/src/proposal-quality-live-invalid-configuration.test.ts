import { describe, expect, it } from 'vitest';
import {
  runProposalLiveConformance,
  type ProposalLiveConformanceOptions,
} from './proposal-quality-live-conformance';

const TOKEN = Buffer.alloc(32, 0x49).toString('base64url');

describe('live conformance configuration fallback', () => {
  it('classifies unexpected evaluator setup failures without retaining details', async () => {
    const options: ProposalLiveConformanceOptions = {
      lifeOsCommitSha: 'a'.repeat(40),
      contextualOrchestratorCommitSha: 'b'.repeat(40),
      modelInventory: ['meta/live-model'],
      evaluatedAt: new Date('2026-08-07T04:00:00.000Z'),
      providerCredentialAvailable: true,
      environment: {
        CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
        CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
      },
    };
    Object.defineProperty(options, 'monotonicClock', {
      get() {
        throw new Error('private setup detail');
      },
    });

    const report = await runProposalLiveConformance(options);
    expect(report.status).toBe('failed');
    expect(report.profiles).toHaveLength(5);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.profiles)).toBe(true);
    for (const profileId of ['route_low', 'route_high', 'conduct_template']) {
      expect(
        report.profiles.find((profile) => profile.profileId === profileId),
      ).toEqual({
        profileId,
        status: 'unavailable',
        unavailableCode: 'invalid_configuration',
      });
    }
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('private setup detail');
    expect(serialized).not.toContain(TOKEN);
  });
});
