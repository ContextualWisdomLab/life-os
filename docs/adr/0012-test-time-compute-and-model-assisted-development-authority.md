# ADR 0012: Test-time compute and model-assisted development authority

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS uses model-backed evaluation for auditable AI-proposal quality and may use model-assisted repository development. These activities can consume different amounts of test-time compute, use single-route or multi-agent orchestration, and depend on external model providers. They must not blur model execution with product authorization, independent review, merge, or release authority.

Protected-main `AGENTS.md` already requires a strong single-model baseline, explicit reasoning/stage/decomposition/recursion/access-topology ablations, `NVIDIA_NIM_API_KEY`, no `COPILOT_GITHUB_TOKEN`, and independent review-agent credentials. The approved live-conformance design records bounded `route_high`, `route_low`, and conducted evaluation cells through an exact contextual-orchestrator dependency, while unsupported cells remain explicit rather than simulated.

## Decision drivers

- correctness, evidence quality, reliability and controllability over agent count or latency;
- comparable-budget evidence before deeper orchestration is preferred;
- deterministic product authorization and proposal validation independent of model availability;
- least-privilege provider credentials and no credential leakage into retained evidence;
- independent review, merge and release authority;
- reproducible, explicitly versioned evaluation cells instead of hidden orchestration defaults;
- standalone LifeOS operation when model providers or contextual-orchestrator are unavailable.

## Considered alternatives

1. **Always use the deepest available multi-agent workflow.** Rejected because agent count is not evidence of quality and adds cost, failure modes and coordination confounds.
2. **Optimize primarily for latency or token count.** Rejected because the product requires defensible correctness and safety evidence; latency/cost remain measured capacity signals.
3. **Let model judgement satisfy deterministic CI, authorization, review, merge or release gates.** Rejected because model output is untrusted evidence, not repository or product authority.
4. **Use a strong single-route baseline and admit deeper orchestration only when retained comparable-budget evidence justifies it.** Selected.

## Decision

1. Every material model-evaluation campaign includes a strong single-model route as the mandatory comparison baseline.
2. Reasoning effort, workflow stages, role-specific reasoning effort for planner/worker/verifier/synthesizer roles, task decomposition, recursion depth, access lists/communication topology, homogeneous-versus-heterogeneous model pools and verification strategy are explicit experimental/control dimensions when supported by the exact dependency revision.
3. Unsupported controls remain explicitly unavailable; LifeOS does not simulate or silently infer them.
4. Deeper orchestration is selected only when retained LifeOS evidence shows a material quality or heterogeneous-capability benefit without unacceptable safety/reliability regression under a reasonably comparable budget. This is a LifeOS product inference, not a claim of universal multi-agent superiority.
5. Latency, token usage and provider cost are recorded for capacity/cost review but are not the sole or primary optimization objective.
6. Model-backed tests and model-assisted development use GitHub Secret `NVIDIA_NIM_API_KEY` through an approved OpenCode or contextual-orchestrator boundary. `COPILOT_GITHUB_TOKEN` is prohibited.
7. Provider credentials materialize only for the bounded model call/credential-seeding boundary and are excluded from retained prompts, responses, hidden reasoning, logs and artifacts.
8. Review-agent identities and credential chains remain independent from development/model-execution identities. Model execution cannot self-approve, weaken protection, merge, release, or alter deterministic acceptance authority.
9. Deterministic authorization, schema validation, product evaluators, CI/security, exact-head evidence, review, merge and release gates remain authoritative when provider execution is unavailable or disagrees.
10. Normal LifeOS runtime/build/release paths remain independently usable without contextual-orchestrator or NVIDIA availability unless a separately accepted product contract explicitly changes that boundary.

## Consequences

- A deeper orchestration profile carries an evidence burden rather than becoming the default by availability.
- Live-provider results are dated conformance/governance evidence and do not become deterministic merge success.
- Evaluation reports must expose profile availability, limitations, quality deltas and bounded resource evidence without retaining sensitive model content.
- New orchestration controls require an explicit contract and regression evidence before they enter production evaluation policy.
- Model-provider outages degrade model-backed evidence collection but do not widen LifeOS product or repository authority.

## Failure and recovery

Missing provider credentials, unavailable provider/model inventory, unsupported orchestration controls, bounded provider failures or stochastic evaluation failures produce explicit sanitized unavailable/failure evidence. They do not fabricate quality results and do not weaken deterministic gates. Recovery is a later bounded rerun against an exact LifeOS/dependency revision or a reviewed fallback profile. A malformed report, unsafe credential/materialization path, invalid dependency identity or deterministic test failure fails closed.

## Security and privacy impact

Model execution receives only the minimum inputs and credentials required by the bounded evaluation/development operation. Raw prompts, raw responses, hidden reasoning, bearer material, provider credentials and unnecessary tenant content are excluded from retained artifacts. Independent review and merge/release governance remain separate authorities. Model output is untrusted even when the provider succeeds. Governance impact is explicit: development-model identity cannot become counted independent review, merge or release authority.

## Compatibility and migration

Existing deterministic LifeOS proposal evaluation remains unchanged and authoritative. Existing live-conformance cells can map to this ADR without changing their result schema. Future contextual-orchestrator pins or orchestration controls are reviewed source/configuration changes and must preserve explicit unsupported-state semantics and credential scoping. Existing review-agent credential names/scopes are not repurposed.

## Acceptance evidence

- Protected-main `AGENTS.md` encodes the strong-route baseline, explicit test-time-compute dimensions, NVIDIA NIM credential boundary, no-Copilot rule and review-identity separation.
- `docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md` defines exact route/conduct cells, credential scoping, bounded retained evidence, unsupported profiles and the quality-first decision rule.
- Canonical Standards/Research Traceability records Fugu, Conductor, TRINITY, the strong-single-agent counterevidence and NVIDIA NIM primary API documentation with publication status.
- Canonical UML shows model-execution authority flowing through deterministic evaluation into credential-free retained evidence and a governance decision, while review/merge/release authority remains separate.
- Documentation contracts fail if these authority boundaries or research anchors disappear.

## Migration and rollback

A policy change may disable or narrow a model-backed profile without affecting deterministic LifeOS operation. Rollback must not restore `COPILOT_GITHUB_TOKEN`, merge/release authority for development models, implicit orchestration controls, fabricated unsupported results, or provider availability as a deterministic merge prerequisite.

## Supersession

A later ADR may supersede this decision only with explicit comparable evidence for the replacement compute-allocation policy, preserved model/reviewer/merge/release authority separation, a credential migration plan, deterministic fallback behavior, and updated canonical traceability/tests.
