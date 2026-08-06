"""Apply deterministic live-conformance fixes before committing verified source."""

from __future__ import annotations

from pathlib import Path


AI_SOURCE_ROOT = Path("apps/ai-service/src")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    """Replace one exact block or fail before writing ambiguous mutations."""

    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def repair_live_model() -> None:
    """Correct failure classification and emit one terminal observation."""

    path = AI_SOURCE_ROOT / "contextual-orchestrator-live-model.ts"
    source = path.read_text(encoding="utf-8")
    import_value = "  ProposalModelTransportError,\n"
    if source.count(import_value) != 1:
        raise SystemExit("proposal transport error import: expected one match")
    source = source.replace(import_value, "", 1)

    old_response = (
        "async function boundedResponseText(response: Response): Promise<string> {\n"
        "  if (!response.ok || response.body === null) {\n"
        "    return fail(\n"
        "      response.status === 429 || response.status >= 500\n"
        "        ? 'provider_unavailable'\n"
        "        : 'orchestrator_unavailable',\n"
        "    );\n"
        "  }\n"
    )
    new_response = (
        "async function boundedResponseText(response: Response): Promise<string> {\n"
        "  if (!response.ok) {\n"
        "    return fail(\n"
        "      response.status === 429 || response.status >= 500\n"
        "        ? 'provider_unavailable'\n"
        "        : 'orchestrator_unavailable',\n"
        "    );\n"
        "  }\n"
        "  if (response.body === null) {\n"
        "    return fail('evaluation_failed');\n"
        "  }\n"
    )
    if source.count(old_response) != 1:
        raise SystemExit(
            "successful response without body classification: expected one block"
        )
    source = source.replace(old_response, new_response, 1)

    elapsed_index = source.index(
        "      const elapsed = this.monotonicClock() - startedAt;\n"
    )
    success_start = source.index(
        "      this.recordedObservations.push(\n", elapsed_index
    )
    outer_catch = source.index(
        "    } catch (error) {\n      const code =", success_start
    )
    replacement = (
        "      let draft: ProposalModelDraft;\n"
        "      try {\n"
        "        draft = parseContextualOrchestratorProposalCompletion(text);\n"
        "      } catch {\n"
        "        return fail('evaluation_failed');\n"
        "      }\n"
        "      this.recordedObservations.push(\n"
        "        observation(\n"
        "          this.configuration.profile,\n"
        "          observedMode,\n"
        "          trace,\n"
        "          parsePlanSource(orchestration?.plan_source),\n"
        "          elapsed,\n"
        "          parseUsage(envelope),\n"
        "          null,\n"
        "        ),\n"
        "      );\n"
        "      return draft;\n"
    )
    path.write_text(
        source[:success_start] + replacement + source[outer_catch:],
        encoding="utf-8",
    )


def repair_report_validation() -> None:
    """Sanitize timestamps and remove impossible fixed-profile branches."""

    path = AI_SOURCE_ROOT / "proposal-quality-live-conformance.ts"
    source = path.read_text(encoding="utf-8")

    timestamp_old = (
        "  const timestamp = requireString(report.evaluatedAt, 64);\n"
        "  if (new Date(timestamp).toISOString() !== timestamp) {\n"
        "    return invalid();\n"
        "  }\n"
    )
    timestamp_new = (
        "  const timestamp = requireString(report.evaluatedAt, 64);\n"
        "  let canonicalTimestamp: string;\n"
        "  try {\n"
        "    canonicalTimestamp = new Date(timestamp).toISOString();\n"
        "  } catch {\n"
        "    return invalid();\n"
        "  }\n"
        "  if (canonicalTimestamp !== timestamp) {\n"
        "    return invalid();\n"
        "  }\n"
    )
    if source.count(timestamp_old) != 1:
        raise SystemExit("timestamp validation sanitization: expected one match")
    source = source.replace(timestamp_old, timestamp_new, 1)

    proposal_id_old = (
        "  const proposalId =\n"
        "    PROFILE_PROPOSAL_IDS[\n"
        "      profile.profileId as keyof typeof PROFILE_PROPOSAL_IDS\n"
        "    ];\n"
        "  if (!proposalId) {\n"
        "    return invalid();\n"
        "  }\n"
    )
    proposal_id_new = (
        "  const proposalId =\n"
        "    PROFILE_PROPOSAL_IDS[\n"
        "      profile.profileId as keyof typeof PROFILE_PROPOSAL_IDS\n"
        "    ]!;\n"
    )
    if source.count(proposal_id_old) != 1:
        raise SystemExit("fixed profile proposal identifier: expected one match")
    source = source.replace(proposal_id_old, proposal_id_new, 1)

    limitations_old = (
        "/** Freezes and validates the fixed limitation statements. */\n"
        "function limitations(): readonly string[] {\n"
        "  if (\n"
        "    DEFAULT_LIMITATIONS.length > MAXIMUM_LIMITATIONS ||\n"
        "    DEFAULT_LIMITATIONS.some(\n"
        "      (item) => item.length === 0 || item.length > MAXIMUM_LIMITATION_LENGTH,\n"
        "    )\n"
        "  ) {\n"
        "    return invalid();\n"
        "  }\n"
        "  return Object.freeze([...DEFAULT_LIMITATIONS]);\n"
        "}\n"
    )
    limitations_new = (
        "/** Freezes the statically reviewed limitation statements. */\n"
        "function limitations(): readonly string[] {\n"
        "  return Object.freeze([...DEFAULT_LIMITATIONS]);\n"
        "}\n"
    )
    if source.count(limitations_old) != 1:
        raise SystemExit("fixed limitation statements: expected one match")
    source = source.replace(limitations_old, limitations_new, 1)

    deltas_old = (
        "        rateDeltasFromBaseline: baseline\n"
        "          ? profile.profileId === 'route_high'\n"
        "            ? baselineDeltas(profile.quality.rates)\n"
        "            : rateDeltas(profile.quality.rates, baseline.quality.rates)\n"
        "          : (Object.freeze(\n"
        "              Object.fromEntries(PRIMARY_RATE_KEYS.map((key) => [key, null])),\n"
        "            ) as ProposalLiveRateDeltas),\n"
    )
    deltas_new = (
        "        rateDeltasFromBaseline:\n"
        "          profile.profileId === 'route_high'\n"
        "            ? baselineDeltas(profile.quality.rates)\n"
        "            : rateDeltas(profile.quality.rates, baseline!.quality.rates),\n"
    )
    if source.count(deltas_old) != 1:
        raise SystemExit("completed profile baseline invariant: expected one match")
    source = source.replace(deltas_old, deltas_new, 1)
    path.write_text(source, encoding="utf-8")


def repair_workflow_contract() -> None:
    """Align deterministic workflow evidence with the secured implementation."""

    path = AI_SOURCE_ROOT / "proposal-quality-live-workflow.test.ts"
    source = path.read_text(encoding="utf-8")
    replacements = (
        (
            "    expect(uses.length).toBeGreaterThanOrEqual(6);",
            "    expect(uses.length).toBeGreaterThanOrEqual(5);",
            "external action count",
        ),
        (
            "    expect(workflow.match(new RegExp(ORCHESTRATOR_COMMIT, 'gu'))?.length).toBe(\n"
            "      4,\n"
            "    );",
            "    expect(workflow.match(new RegExp(ORCHESTRATOR_COMMIT, 'gu'))?.length).toBe(\n"
            "      3,\n"
            "    );",
            "pinned commit occurrence count",
        ),
        (
            "CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765'",
            "'CONTEXTUAL_ORCHESTRATOR_LIVE_URL': 'http://127.0.0.1:8765'",
            "loopback runtime configuration assertion",
        ),
    )
    for old, new, label in replacements:
        count = source.count(old)
        if count != 1:
            raise SystemExit(f"{label}: expected one match, found {count}")
        source = source.replace(old, new, 1)

    dependency_anchor = (
        "    ).toContain('_contextual_orchestrator/requirements.lock');\n"
    )
    dependency_index = source.index(dependency_anchor)
    dependency_evidence = (
        "    expect(\n"
        "      step('Install pinned contextual-orchestrator dependencies'),\n"
        "    ).not.toContain('--no-deps');\n"
        "    expect(\n"
        "      step('Install pinned contextual-orchestrator dependencies'),\n"
        "    ).not.toContain('./_contextual_orchestrator');\n"
    )
    source = (
        source[: dependency_index + len(dependency_anchor)]
        + dependency_evidence
        + source[dependency_index + len(dependency_anchor) :]
    )

    server_anchor = (
        "    const server = step('Start the loopback contextual-orchestrator');\n"
    )
    server_index = source.index(server_anchor)
    source = (
        source[: server_index + len(server_anchor)]
        + "    expect(server).toContain(\n"
        + "      'working-directory: _contextual_orchestrator',\n"
        + "    );\n"
        + source[server_index + len(server_anchor) :]
    )
    path.write_text(source, encoding="utf-8")


def repair_failure_observation_evidence() -> None:
    """Assert every malformed completion produces one failure observation."""

    path = AI_SOURCE_ROOT / "contextual-orchestrator-live-model.test.ts"
    source = path.read_text(encoding="utf-8")
    loop_index = source.index(
        "  for (const [index, nextResponse] of malformedResponses.entries()) {"
    )
    assertion = (
        "      expect(fixture.model.observations().at(-1)?.failureCode).toBe(\n"
        "        'evaluation_failed',\n"
        "      );\n"
    )
    assertion_index = source.index(assertion, loop_index)
    source = (
        source[:assertion_index]
        + "      expect(fixture.model.observations()).toHaveLength(1);\n"
        + source[assertion_index:]
    )
    path.write_text(source, encoding="utf-8")


def main() -> None:
    """Apply every reviewed correction as one fail-fast mutation set."""

    repair_live_model()
    repair_report_validation()
    repair_workflow_contract()
    repair_failure_observation_evidence()


if __name__ == "__main__":
    main()
