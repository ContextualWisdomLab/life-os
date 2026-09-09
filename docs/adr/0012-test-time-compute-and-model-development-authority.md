# ADR 0012: Test-time compute and model-assisted development authority

**Status:** Accepted architecture

## Context

LifeOS uses deterministic product logic for authorization, persistence, proposal validation, safety checks, merge eligibility and release acceptance, while selected development and live-conformance workflows may call language models. The repository already has a strong single-route proposal-quality baseline and a bounded contextual-orchestrator evaluation path. Repository-wide agent guidance also requires model-backed work to use `NVIDIA_NIM_API_KEY`, prohibits `COPILOT_GITHUB_TOKEN`, and keeps independent review credentials separate.

Recent orchestration evidence does not justify a universal rule that more agents are better. Sakana Fugu exposes query-adaptive direct-or-orchestrated execution; the ICLR 2026 Conductor work learns worker selection, targeted instructions, communication topology and recursive orchestration; TRINITY assigns Thinker, Worker and Verifier roles over multiple turns. Counterevidence from a strong-single-agent baseline shows that homogeneous multi-agent workflows can sometimes be matched by one multi-turn agent with efficiency advantages. LifeOS therefore needs an explicit evidence-driven allocation rule rather than a fixed multi-agent preference.

The detailed live-conformance implementation and references remain in `docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md`. This ADR promotes only the durable repository-wide authority decision.

## Decision drivers

- Product correctness, evidence quality, controllability and security outrank latency.
- Additional test-time compute must be justified against a strong simpler baseline under a comparable declared budget.
- Workflow stages, task decomposition, recursion depth, model/role selection, role-specific reasoning effort, verifier topology and access lists must remain explicit experimental variables instead of hidden orchestration defaults.
- Model/provider availability must not become authorization, review, merge or release authority.
- Live-provider evidence must be reproducible, bounded, credential-safe and separable from deterministic pull-request gates.
- LifeOS and contextual-orchestrator must remain independently deployable.

## Alternatives

### Always use a single model

This minimizes orchestration complexity and is a necessary baseline, but it can prevent measured gains from heterogeneous specialization, parallel exploration or independent verification.

### Always use a fixed multi-agent workflow

This provides predictable topology but spends extra compute on tasks where it may not help, can hide which design dimension produced a gain, and conflicts with evidence that strong single-agent workflows may equal homogeneous multi-agent systems.

### Adapt compute from measured evidence — selected

Measure a strong single-model route first, compare additional bounded cells under explicit budgets and controls, and authorize deeper orchestration only when retained LifeOS evidence shows a meaningful quality/evidence gain without deterministic safety or conformance regression.

## Decision

1. **Strong baseline first.** Every material model-assisted evaluation includes a strong single-model route before any claim that a conducted or multi-agent profile is preferable.
2. **Explicit test cells.** Reasoning effort, workflow stage, decomposition, recursion depth, worker/model assignment, role-specific reasoning effort, verifier topology, access list/topology and total provider-call/token budget are explicit configuration or evidence fields where supported.
3. **Comparable budgets.** Claims about orchestration benefit compare cells under documented comparable budgets or clearly disclose the budget difference as a limitation. More agents or tokens are never counted as an intrinsic product improvement.
4. **Quality-first selection.** Latency, tokens and provider cost are measured for capacity and commercial review but are not the primary optimization objective. Correctness, evidence quality, safety, reliability and controllability determine acceptance.
5. **Unsupported controls stay unavailable.** A pinned orchestrator that cannot expose a requested recursion, role-effort or generated-topology control returns explicit unsupported evidence. Tests do not simulate or fabricate that ablation.
6. **Credential boundary.** Model-backed LifeOS development/live tests use GitHub Secret `NVIDIA_NIM_API_KEY`, preferably through the exact reviewed contextual-orchestrator integration. `COPILOT_GITHUB_TOKEN` is prohibited for development-model execution.
7. **Independent reviewer boundary.** Existing review-agent identities, credentials and keys remain independent and are never repurposed as development-model authority.
8. **Deterministic authority.** Model outputs are untrusted proposals/evidence. Deterministic LifeOS authorization, schema validation, proposal evaluation, CI/security checks, formal review rules, branch protection, merge decision and release gates remain authoritative even if all models/providers are unavailable.
9. **No hidden reasoning retention.** Retained evidence is bounded and credential-free and excludes prompts, model responses, hidden reasoning and provider secrets unless a separately reviewed product contract explicitly requires otherwise.
10. **Standalone/MSA compatibility.** Normal LifeOS runtime, deterministic tests and release artifacts do not require contextual-orchestrator or NVIDIA availability. The integration composes versioned public contracts only.

## Consequences

- A simple route remains the default comparison rather than a second-class fallback.
- Multi-agent/conducted execution can be used when measured LifeOS evidence supports it, including heterogeneous-model settings where single-agent equivalence is not assumed.
- Evaluation reports become more verbose because they record supported/unsupported cells and budget limitations explicitly.
- Orchestrator capability changes require a reviewed pin/update and fresh evidence instead of silently changing the experiment.
- Provider outages can make live-conformance cells unavailable without turning deterministic CI green or red by inference.

## Failure and recovery

- Missing provider credentials or model inventory produces explicit unavailable evidence and no fabricated quality result.
- Provider/orchestrator failure cannot bypass deterministic proposal validation or repository gates.
- If a conducted cell regresses injection resistance, operation conformance, grounding or other primary quality criteria, retain the strong single-route profile.
- If a newer orchestrator changes workflow semantics, freeze the old reviewed pin until the new source, contract tests and result schema are reviewed.
- If evidence later shows a different baseline or budget-allocation method is materially better, supersede this ADR rather than weakening the comparison contract ad hoc.

## Security and privacy impact

Only the credential-seeding step may receive `NVIDIA_NIM_API_KEY`. LifeOS application code and retained artifacts do not receive or serialize provider credentials. Model execution receives bounded fixture/user data according to the reviewed feature contract and never gains database, branch-protection, review, merge or release authority. Secrets, raw prompts/responses and hidden reasoning are excluded from retained evidence by default. The contextual-orchestrator dependency is pinned to an exact reviewed commit when used.

## Acceptance evidence

- `AGENTS.md` preserves the NVIDIA NIM/no-Copilot and explicit orchestration-variable rules.
- Root `ARCHITECTURE.md` preserves the strong-route-first and deterministic-authority boundaries.
- `docs/UML.md` shows credential seeding, route/conduct cells, deterministic LifeOS evaluation, credential-free evidence and governance authority separation.
- `docs/STANDARDS_TRACEABILITY.md` records Fugu, Conductor, TRINITY, strong-single-agent counterevidence and NVIDIA NIM primary documentation with publication status and APA 7 references.
- `packages/commercial-readiness/src/documentation-contract.test.mjs` fails if these canonical decisions disappear.
- The live-conformance harness validates bounded report schemas, unsupported cells and credential scoping without making live provider availability a pull-request merge gate.

## Migration and rollback

Existing deterministic proposal behavior needs no data migration. Model-assisted workflows should migrate by adding explicit profile/budget evidence fields while preserving previous report versions for dated evidence. A rollback disables or removes a model-assisted profile without changing deterministic product authorization or stored LifeOS user data. Credential names and independent reviewer credentials are not migrated by this ADR.

## Supersession

Supersede this ADR if LifeOS adopts a materially different model-development authority, eliminates model-assisted evaluation entirely, changes the deterministic-vs-model governance split, or obtains stronger product evidence that requires a different baseline/budget-selection contract. A provider or model change alone does not supersede the decision.
