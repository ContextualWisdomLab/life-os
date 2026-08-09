# LifeOS agent contract

This file is the canonical repository-wide operating contract for coding agents. `ARCHITECTURE.md` defines durable system boundaries; `docs/PRD.md` and `docs/TRD.md` define canonical product/technical requirements; ADRs, data/UML/threat/test/operability/traceability docs and scoped feature specifications/runbooks provide detail without weakening those boundaries.

## Work-conserving pull-request loop

For every open pull request:

1. refetch the exact current contributor head and exact live base tip;
2. read every human, CodeRabbit, AppGuardrail, code-scanning, security and other configured finding;
3. diagnose the root cause of every failed, missing, stale or required gate;
4. verify the narrowest remedy is operationally real before relying on it;
5. make a complete test-first causal correction with required documentation/cleanup;
6. rerun/inspect required checks on the corrected exact head;
7. resolve only review threads whose underlying issue is actually addressed;
8. merge only when repository policy accepts the exact unchanged head;
9. immediately continue with the next safe PR/review/cleanup/product/documentation/release-readiness action while run budget remains.

A queued check, unavailable provider, Draft state, failed first tool path, reviewer delay or writer conflict blocks only the affected action. Do not spend an otherwise productive run narrating or repeatedly proving an unchanged blocker.

Never use administrative bypass, fabricate approval/evidence, or claim completion from stale/predecessor/synthetic-merge-only checks.

## Writer lease

Before a branch-affecting write, refetch exact head/base/ref/blob state. If another source writer moves the same target, discard stale assumptions and freeze writes to that target for the run while continuing non-conflicting review, RCA, testing, documentation, dependency, product-gap or operability work. A writer conflict is a concurrency condition, not repository-wide completion.

## Code-owner review gates — disabled on hold

As of 2026-08-04, code-owner review requirements (`require_code_owner_reviews` in branch protection and `require_code_owner_review` in rulesets) are disabled across the ContextualWisdomLab organization because there is one maintainer and that gate cannot be satisfied. Do not treat this historical repository setting as permission to fabricate an approval or bypass whatever independent review/security checks are actually configured now. Refetch live policy before merge.

## Modular MSA rules

- Every bounded service runs independently and remains composable in the LifeOS monorepo deployment.
- Services communicate through versioned HTTP, event, saga, plugin, or MCP contracts.
- A service must not read or mutate another service's database tables.
- Each service owns migrations, runtime configuration, persistence adapters, observability, tests, and shutdown behavior.
- Internal identifiers are opaque UUIDv4 strings. Numeric/provider-native identifiers never become internal primary keys.
- Database objects use descriptive multiword `snake_case` names unless an external protocol mandates another spelling.
- Browser-local drafts/caches are not durable product truth until an authorized owning service confirms persistence.
- Rename stale internal product/caller names when they no longer match public software identity, preserving compatibility/migration evidence.

## Canonical documentation and status

The repository must be understandable without reconstructing chat history, old PR bodies, or assistant output.

Canonical documentation graph:

1. `docs/PRD.md` — product outcomes, users, requirements and status.
2. `docs/TRD.md` — shared technical/runtime/security/release requirements.
3. `ARCHITECTURE.md` — durable bounded contexts and authority.
4. `docs/adr/README.md` — material decisions/supersession history.
5. `docs/DATA_MODEL.md` — logical service-owned ERD/data model.
6. `docs/UML.md` — component/sequence/state/deployment/failure views.
7. `SECURITY.md` and `docs/THREAT_MODEL.md` — reporting policy versus architecture threats.
8. `docs/TEST_STRATEGY.md` — deterministic/live quality evidence.
9. `docs/OPERABILITY.md` — deployment/diagnostics/backup/recovery ownership.
10. `docs/TRACEABILITY.md` — requirement/decision/capability → source/test/runbook evidence.
11. `docs/operations/`, `docs/research/`, `docs/legal/`, `docs/superpowers/specs/`, `docs/superpowers/plans/` — scoped supporting evidence.
12. `CHANGELOG.md` — buyer-visible unreleased/released changes.

Use exact statuses: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, `Out of scope`.

Never describe target architecture as shipped behavior. Protected-main source/migrations/tests outrank stale prose. The 2026-08-02 combined LifeOS design is historical input where canonical docs/ADRs supersede it.

When a documentation audit finds a real implementation gap, continue into the smallest executable test/code/migration/API/UX task when safe; documentation completion is not a terminal product result.

## Quality and testing

- Production declarations have explanatory docstrings sufficient for a new contributor to understand the contract without reconstructing implementation.
- Packages enforcing exact coverage retain 100% statement, branch, function, and line coverage with meaningful assertions.
- Tests prove realistic domain accuracy, tenant isolation, concurrency/replay, failure/recovery and customer journeys rather than mocked call counts only.
- Use real PostgreSQL integration evidence for material persistence semantics.
- Deterministic merge gates remain separate from bounded live-provider conformance.
- Standards/papers/research claims are recorded in `docs/research/` or approved feature specs with APA 7 references and publication status.
- Update relevant canonical docs, scoped specs/plans/runbooks and `CHANGELOG.md` when a behavior/authority boundary changes.
- A release version/tag is created only when exact integrated release readiness is proven; otherwise changes remain under `CHANGELOG.md` → `Unreleased`.

## AI and model-provider rules

- AI proposals are inert, explainable suggestions and cannot silently mutate user-owned data.
- Model-assisted tests/development use `NVIDIA_NIM_API_KEY` through the approved OpenCode or contextual-orchestrator boundary where model access is required.
- Do not alter/reuse the credential scheme of existing independent review agents merely to make a development agent work.
- Provider credentials, browser cookies, bearer material, raw prompts/responses, hidden reasoning and stack traces do not enter retained public artifacts.
- Live-provider availability is not a deterministic PR merge requirement unless a separately reviewed gate explicitly requires it; missing/unavailable providers produce sanitized evidence.

### Test-time compute allocation

A strong single-model route is the mandatory baseline. Deeper orchestration is justified only by measured quality/control benefit or heterogeneous capability coverage. Explicitly model/ablate reasoning effort, workflow stages, planner/worker/verifier/synthesizer roles, task decomposition, recursive depth, access lists/topology and model-pool composition. Latency/token use are capacity evidence rather than the sole decision criterion.

## Mathematical and psychometric modules

Any future production mathematical/psychometric computation layer must:

- implement numerical kernels in Rust;
- support deterministic low-context-switch CPU multithreading and a parity-verified GPU boundary where justified;
- test true-parameter recovery, bias, interval coverage, convergence and RMSE;
- model multilevel/multiple-membership structures where required to avoid invalid aggregation;
- model temporal change/repeated measurement/drift/state evolution where the estimand changes over time;
- document estimands, assumptions, precision, seed/convergence/fallback behavior with APA 7 references.

## Security and privacy

- Treat external responses, stored JSON, environment values, model output, connector results, calendar/plugin payloads and database rows as untrusted until bounded and validated.
- Keep SQL structure static and parameterize dynamic values.
- Fail closed on malformed ownership, identifiers, signatures, digests, timestamps, pagination, provider configuration and privileged grants.
- Public problems, metrics, logs and artifacts are credential-free/bounded and avoid unnecessary personal content.
- Sensitive access is purpose/resource/actor scoped with auditable evidence where privileged access exists; indiscriminate masking is not a substitute for authorization.
- Temporary repair scaffolding is removed after durable evidence is secured unless it is intentionally accepted product automation.

## Waiting and escalation

Waiting for checks, reviews or a long-running model/agent is not by itself a blocker. Continue non-conflicting analysis, tests, documentation, cleanup, buyer-gap or operational work. Escalate only when a product/governance/permission/secret decision cannot be resolved from live repository policy, evidence, standards and realistically available tools and no other safe work remains for the finite run.
