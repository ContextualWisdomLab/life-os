# Claude operating contract for LifeOS

`AGENTS.md` is the canonical repository-wide execution contract. `ARCHITECTURE.md` and the canonical documentation graph define durable product/technical boundaries. This file is a concise Claude-compatible handoff and must not override live branch/ruleset/security policy.

## Execution order

1. Refetch protected `main`, every open PR/issue, exact current heads and live base tips.
2. Read current human, CodeRabbit, AppGuardrail, code-scanning/security and workflow evidence.
3. Identify the exact commit/tree inspected by each check.
4. Merge any exact-head PR that is genuinely gate-clean.
5. For a valid defect, establish a realistic failing boundary, make the smallest root-cause correction and verify the exact new head.
6. Resolve only addressed review threads and close only proven superseded duplicates.
7. When one lane waits, immediately continue another non-conflicting lane.
8. Keep canonical docs synchronized with protected main and active PR/issue status.
9. Convert documentation-discovered buyer gaps into implementation/test/migration/API/UX work when safe.
10. Before ending, refetch the whole queue and continue if any safe action remains.

Routine progress narration is not repository evidence. One commit, merge, issue, PR, RCA, documentation update or queued check is not a completion condition by itself.

## Writer lease

Before every LifeOS write, refetch exact target head, live base, target blob/ref and review state. Do not race another source writer. Dedicated loops in other repositories are read-only dependencies. Historical assistant prompts are not automatically user-declared prohibitions; current repository policy/evidence/safety governs mechanism choice.

## Non-negotiable product boundaries

- Internal durable identifiers are UUIDv4 strings; provider IDs remain explicit mappings.
- Database objects use descriptive multiword `snake_case` names unless an external protocol requires another form.
- Services never directly read/mutate another service's tables.
- Browser-local state is not durable until accepted by the owning service.
- AI proposals remain inert until a separately authorized explicit product/user decision.
- Authentication age is distinct from session issuance/rotation time.
- Sensitive access is actor/workspace/resource/purpose/lifetime bound and auditable where required.
- A data-rights request ledger is not proof of complete cross-domain export/erasure.

## Canonical documentation

Whole-product truth must be discoverable through:

- `docs/PRD.md`
- `docs/TRD.md`
- `ARCHITECTURE.md`
- `docs/adr/README.md`
- `docs/DATA_MODEL.md`
- `docs/UML.md`
- `docs/API_CONTRACTS.md`
- `SECURITY.md`
- `docs/THREAT_MODEL.md`
- `docs/PRIVACY_DATA_LIFECYCLE.md`
- `docs/TEST_STRATEGY.md`
- `docs/OPERABILITY.md`
- `docs/RELEASE_AND_MIGRATION.md`
- `docs/STANDARDS_TRACEABILITY.md`
- `docs/TRACEABILITY.md`
- `docs/DOCUMENTATION_ASSESSMENT.md`

Canonical status values are exactly: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, `Out of scope`.

Do not infer current truth from an old resolved review. Compare exact current documentation to protected-main source/migrations and live PRs/issues. If the canonical docs branch materially diverges, use one clean successor from current main, preserve/reconcile unique content, verify it, then supersede the old PR.

## Model and orchestration boundaries

LifeOS autonomous development uses the approved OpenCode/NVIDIA boundary when model access is needed; deterministic source correctness does not depend on live provider availability. Do not repurpose independent review-agent credentials. Browser/product/provider credentials, raw model responses and hidden reasoning do not enter retained public artifacts.

Use a strong single-model route as the mandatory baseline. Additional orchestration is justified through measured quality/control benefit, not agent count or latency alone.

## Verification standard

- exact contributor-head evidence is distinguished from merge-tree compatibility evidence;
- realistic tests cover domain outcomes, tenancy, replay, concurrency, migration and recovery as applicable;
- changed owned production code preserves exact coverage gates where the package requires them;
- public production declarations have explanatory docstrings;
- standards/research claims record APA 7 references and publication status;
- buyer-visible changes update `CHANGELOG.md`;
- release version/tag changes happen only after one exact protected integrated head proves release readiness.

## Safe escalation

Escalate only for a specific product/governance/permission decision that cannot be resolved from fresh repository policy, tests, standards or available tools and when no other safe productive lane remains. Waiting for CI/review/provider availability is local to that lane.