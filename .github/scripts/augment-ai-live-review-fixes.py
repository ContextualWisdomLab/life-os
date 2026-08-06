"""Augment the PR #117 review fixes with exhaustive branch evidence."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AI = ROOT / "apps/ai-service/src"


def read(path: Path) -> str:
    """Read one UTF-8 source file."""

    return path.read_text(encoding="utf-8")


def write(path: Path, source: str) -> None:
    """Write one UTF-8 source file."""

    path.write_text(source, encoding="utf-8")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact source block or fail without ambiguity."""

    source = read(path)
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    write(path, source.replace(old, new, 1))


def add_baseline_delta_seam() -> None:
    """Expose and exercise the no-baseline delta behavior directly."""

    path = AI / "proposal-quality-live-conformance.ts"
    source = read(path)
    marker = """/** Returns a fixed unsupported profile cell. */
function unsupportedProfile(profileId: string): ProposalLiveUnavailableProfile {
"""
    helper = """/** Applies comparable deltas while preserving a missing baseline as null. */
export function applyProposalLiveRateDeltas(
  profiles: readonly ProposalLiveProfile[],
): readonly ProposalLiveProfile[] {
  const baseline = completedProfile(profiles, 'route_high');
  return Object.freeze(
    profiles.map((profile) => {
      if (
        profile.status !== 'completed' &&
        profile.status !== 'completed_with_failures'
      ) {
        return profile;
      }
      return Object.freeze({
        ...profile,
        rateDeltasFromBaseline:
          profile.profileId === 'route_high'
            ? baselineDeltas(profile.quality.rates)
            : baseline
              ? rateDeltas(profile.quality.rates, baseline.quality.rates)
              : nullDeltas(),
      });
    }),
  );
}

"""
    if source.count(marker) != 1:
        raise SystemExit("baseline delta helper marker: expected one match")
    source = source.replace(marker, helper + marker, 1)
    old_mapping = """  const baseline = completedProfile(supportedProfiles, 'route_high');
  const profilesWithDeltas: ProposalLiveProfile[] = supportedProfiles.map(
    (profile) => {
      if (
        profile.status !== 'completed' &&
        profile.status !== 'completed_with_failures'
      ) {
        return profile;
      }
      return Object.freeze({
        ...profile,
        rateDeltasFromBaseline:
          profile.profileId === 'route_high'
            ? baselineDeltas(profile.quality.rates)
            : baseline
              ? rateDeltas(profile.quality.rates, baseline.quality.rates)
              : nullDeltas(),
      });
    },
  );
"""
    new_mapping = """  const profilesWithDeltas: ProposalLiveProfile[] = [
    ...applyProposalLiveRateDeltas(supportedProfiles),
  ];
"""
    if source.count(old_mapping) != 1:
        raise SystemExit("baseline delta call site: expected one match")
    write(path, source.replace(old_mapping, new_mapping, 1))

    test_path = AI / "proposal-quality-live-null-baseline.test.ts"
    write(
        test_path,
        """import { describe, expect, it } from 'vitest';
import {
  applyProposalLiveRateDeltas,
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

/** Creates one minimal completed cell for delta-composition evidence. */
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

describe('live conformance missing baseline deltas', () => {
  it('retains completed non-baseline evidence with all deltas undefined', () => {
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

  it('returns zero deltas for the completed baseline and comparable deltas elsewhere', () => {
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
});
""",
    )


def cover_trace_edge_limit() -> None:
    """Exercise a valid prior-step topology that exceeds the aggregate cap."""

    path = AI / "contextual-orchestrator-live-model.test.ts"
    source = read(path)
    marker = """    [
      { role: 'thinker', agent_id: 'a', access: [], output: 'x' },
      { role: 'worker', agent_id: 'b', access: [0, 0], output: 'x' },
    ],
    [null],
"""
    replacement = """    [
      { role: 'thinker', agent_id: 'a', access: [], output: 'x' },
      { role: 'worker', agent_id: 'b', access: [0, 0], output: 'x' },
    ],
    Array.from({ length: 32 }, (_, stepIndex) => ({
      role: 'worker',
      agent_id: `worker_${stepIndex}`,
      access: Array.from({ length: stepIndex }, (_unused, index) => index),
      output: 'x',
    })),
    [null],
"""
    if source.count(marker) != 1:
        raise SystemExit("aggregate access cap test: expected one match")
    write(path, source.replace(marker, replacement, 1))


def expand_cell_validation_tests() -> None:
    """Exercise every rejected retained-cell category."""

    path = AI / "proposal-quality-live-conformance.test.ts"
    source = read(path)
    marker = """    const invalidRecommendation = mutableReport(report);
"""
    tests = """    const invalidCellMutations: Array<
      (candidate: Record<string, unknown>) => void
    > = [
      (candidate) => {
        const cell = (candidate.profiles as Array<Record<string, unknown>>)[0]!;
        cell.extra = true;
      },
      (candidate) => {
        const cell = (candidate.profiles as Array<Record<string, unknown>>)[3]!;
        delete cell.unavailableCode;
      },
      (candidate) => {
        const cell = (candidate.profiles as Array<Record<string, unknown>>)[3]!;
        cell.unavailableCode = 'private_failure';
      },
      (candidate) => {
        const quality = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .quality as Record<string, unknown>
        );
        quality.modelLabel = 'route_high';
      },
      (candidate) => {
        const quality = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .quality as Record<string, unknown>
        );
        quality.evaluatedAt = '2026-08-06T06:00:00Z';
      },
      (candidate) => {
        const counts = (
          (
            (candidate.profiles as Array<Record<string, unknown>>)[0]!
              .quality as Record<string, unknown>
          ).counts as Record<string, unknown>
        );
        counts.totalCases = -1;
      },
      (candidate) => {
        const rates = (
          (
            (candidate.profiles as Array<Record<string, unknown>>)[0]!
              .quality as Record<string, unknown>
          ).rates as Record<string, unknown>
        );
        rates.validProposalRate = null;
      },
      (candidate) => {
        const quality = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .quality as Record<string, unknown>
        );
        (quality.cases as unknown[]).pop();
      },
      (candidate) => {
        const item = (
          (
            (candidate.profiles as Array<Record<string, unknown>>)[0]!
              .quality as Record<string, unknown>
          ).cases as Array<Record<string, unknown>>
        )[0]!;
        item.extra = 'private text';
      },
      (candidate) => {
        const item = (
          (
            (candidate.profiles as Array<Record<string, unknown>>)[0]!
              .quality as Record<string, unknown>
          ).cases as Array<Record<string, unknown>>
        )[0]!;
        item.category = 'other';
      },
      (candidate) => {
        const item = (
          (
            (candidate.profiles as Array<Record<string, unknown>>)[0]!
              .quality as Record<string, unknown>
          ).cases as Array<Record<string, unknown>>
        )[0]!;
        item.failureCode = 'provider_secret';
      },
      (candidate) => {
        const item = (
          (
            (candidate.profiles as Array<Record<string, unknown>>)[0]!
              .quality as Record<string, unknown>
          ).cases as Array<Record<string, unknown>>
        )[0]!;
        item.targetedOperations = 0;
        item.groundedTargetOperations = 1;
      },
      (candidate) => {
        const item = (
          (
            (candidate.profiles as Array<Record<string, unknown>>)[0]!
              .quality as Record<string, unknown>
          ).cases as Array<Record<string, unknown>>
        )[0]!;
        item.forbiddenTextPassed = 'yes';
      },
      (candidate) => {
        const observations = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .observations as Record<string, unknown>
        );
        observations.extra = true;
      },
      (candidate) => {
        const observations = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .observations as Record<string, unknown>
        );
        (observations.roleCounts as Record<string, unknown>)['Bad Role'] = 1;
      },
      (candidate) => {
        const observations = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .observations as Record<string, unknown>
        );
        observations.elapsedMilliseconds = -1;
      },
      (candidate) => {
        const observations = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .observations as Record<string, unknown>
        );
        observations.acceptedVerifierCalls = 2;
        observations.verifierObservedCalls = 1;
      },
      (candidate) => {
        const observations = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .observations as Record<string, unknown>
        );
        observations.failureCodes = ['provider_unavailable', 'provider_unavailable'];
      },
      (candidate) => {
        const observations = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .observations as Record<string, unknown>
        );
        observations.failureCodes = ['private_failure'];
      },
      (candidate) => {
        const usage = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .usage as Record<string, unknown>
        );
        usage.totalTokens = 1.5;
      },
      (candidate) => {
        const deltas = (
          (candidate.profiles as Array<Record<string, unknown>>)[0]!
            .rateDeltasFromBaseline as Record<string, unknown>
        );
        deltas.validProposalRate = Number.POSITIVE_INFINITY;
      },
      (candidate) => {
        const cells = candidate.profiles as Array<Record<string, unknown>>;
        cells[4] = { ...cells[4], profileId: 'unknown_profile' };
      },
      (candidate) => {
        candidate.modelCount = 0;
      },
    ];
    for (const mutate of invalidCellMutations) {
      const candidate = mutableReport(report);
      mutate(candidate);
      invalidReports.push(candidate);
    }

"""
    if source.count(marker) != 1:
        raise SystemExit("extended cell validation tests: expected one match")
    write(path, source.replace(marker, tests + marker, 1))


def main() -> None:
    """Apply the remaining coverage-oriented review evidence."""

    add_baseline_delta_seam()
    cover_trace_edge_limit()
    expand_cell_validation_tests()


if __name__ == "__main__":
    main()
