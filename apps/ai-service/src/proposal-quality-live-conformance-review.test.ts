import { describe, expect, it } from 'vitest';
import {
  applyProposalLiveRateDeltas,
  runProposalLiveConformance,
  type ProposalLiveProfile,
} from './proposal-quality-live-conformance';

const RATES = Object.freeze({
  validProposalRate: 1,
  operationConformanceRate: 1,
  targetGroundingRate: 1,
  forbiddenTextPassRate: 1,
  benignUtilityRate: 1,
  promptInjectionResistanceRate: 1,
});

/** Creates one minimal completed cell for deterministic delta composition. */
function completed(profileId: string): ProposalLiveProfile {
  return {
    profileId,
    status: 'completed',
    quality: { rates: RATES },
    observations: {},
    usage: {},
    rateDeltasFromBaseline: {},
  } as unknown as ProposalLiveProfile;
}

describe('live conformance review regressions', () => {
  it('retains completed non-baseline evidence with null deltas when the baseline is unavailable', () => {
    const profiles = applyProposalLiveRateDeltas([
      completed('route_low'),
      {
        profileId: 'route_high',
        status: 'unavailable',
        unavailableCode: 'provider_unavailable',
      },
      completed('conduct_template'),
    ]);

    for (const profile of profiles) {
      if (profile.status === 'completed') {
        expect(Object.values(profile.rateDeltasFromBaseline)).toEqual([
          null,
          null,
          null,
          null,
          null,
          null,
        ]);
      }
    }
  });

  it('returns zero deltas for the baseline and comparable equal-rate cells', () => {
    const profiles = applyProposalLiveRateDeltas([
      completed('route_high'),
      completed('route_low'),
    ]);

    for (const profile of profiles) {
      if (profile.status === 'completed') {
        expect(Object.values(profile.rateDeltasFromBaseline)).toEqual([
          0,
          0,
          0,
          0,
          0,
          0,
        ]);
      }
    }
  });

  it('preserves sanitized live-model failure codes from invalid profile configuration', async () => {
    const report = await runProposalLiveConformance({
      lifeOsCommitSha: 'a'.repeat(40),
      contextualOrchestratorCommitSha: 'b'.repeat(40),
      modelInventory: ['meta/live-model'],
      evaluatedAt: new Date('2026-08-06T09:00:00.000Z'),
      providerCredentialAvailable: true,
      environment: {
        CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'https://not-loopback.example',
        CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: Buffer.alloc(32, 0x5a).toString(
          'base64url',
        ),
      },
    });

    expect(
      report.profiles
        .slice(0, 3)
        .map((profile) =>
          profile.status === 'unavailable' ? profile.unavailableCode : null,
        ),
    ).toEqual([
      'orchestrator_unavailable',
      'orchestrator_unavailable',
      'orchestrator_unavailable',
    ]);
  });
});
