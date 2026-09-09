# Claude operating contract for LifeOS

`AGENTS.md` is the canonical repository-wide instruction file. `ARCHITECTURE.md` is the durable system-boundary source of truth. The canonical product documentation graph is indexed from `README.md` and includes PRD, TRD, ADRs, Data Model, UML, API contracts, threat/privacy/test/operability/release/standards/traceability views. This document maps those authorities into a concise execution order for Claude-compatible agents and must not override live repository policy.

## Execution order

1. Inspect every open pull request before starting unrelated implementation.
2. Read all human, CodeRabbit, AppGuardrail, code-scanning, and security feedback.
3. Determine the root cause of every failing or pending-required check.
4. Make the smallest complete correction, including tests and documentation.
5. Re-run the exact pull-request head and resolve only threads whose finding is actually addressed.
6. Merge only when required checks pass, no actionable findings remain, and the repository's merge policy accepts the exact head.
7. Non-force restack dependent branches after an accepted parent change; never discard concurrent valid delta.
8. Continue with the highest-impact buyer-visible gap after the pull-request queue is empty or a current lane is independently blocked.

Routine progress narration is not a substitute for repository evidence. Record durable decisions in canonical docs/ADRs, code, tests, runbooks, issues, and pull-request evidence with truthful protected-main/active-PR/planned maturity.

## Non-negotiable boundaries

- Never use `COPILOT_GITHUB_TOKEN`.
- All model capability is consumed through an immutable reviewed `contextual-orchestrator` API/client/schema. GitHub Actions model-backed work uses only virtual `orchestrator/free` plus the gateway authentication token; provider/model/group selection and provider credentials remain contextual-orchestrator owner authority.
- `BYTEZ`, `NVIDIA_NIM`/`NVIDIA_NIM_SUB`, `OPENROUTER`, `OPENAI`, embedding, responses/completions, audio/video/image and other model/provider credential discovery stay in contextual-orchestrator. LifeOS does not copy mutable owner source or add a direct-provider fallback when a capability is missing.
- Do not alter or repurpose the credential scheme of existing review agents.
- Never forward browser cookies, provider credentials, hidden reasoning, raw prompts, raw model responses, or stack traces into retained artifacts.
- Internal identifiers are UUIDv4 strings; numeric/external provider identifiers are mapped through explicit provider-identity boundaries.
- Database objects use multiword `snake_case` names unless an external protocol mandates a different spelling.
- Services own their persistence, migrations, credentials, transaction boundaries and recovery. They do not read or mutate another service's database tables.
- Browser-local state is not durable until accepted by the owning service.
- AI proposals remain inert until a separately authorized user-confirmed execution capability exists.
- Sensitive access is tenant/resource/purpose/lifetime/audit bound rather than relying on blanket masking.
- Mathematical, psychometric, EDA, data-science, performance and security hot kernels are Rust-first; numerical claims require deterministic CPU/GPU parity as applicable, realistic parameter-recovery/error evidence, multilevel or multiple-membership structure, and temporal modeling where applicable.

## LLM orchestration decisions

Use a strong single-route baseline before deeper orchestration. Allocate additional test-time compute only through explicit profiles that identify reasoning effort, workflow stages, role assignment, decomposition, recursive depth, worker/model choice where the owner exposes it, verifier topology, and access/communication topology. Use measured proposal validity, grounding, utility, and prompt-injection resistance to justify deeper orchestration. Fugu/Conductor/TRINITY-style experiments are evidence profiles, not authority.

LifeOS does not seed provider credentials directly. The target model-assisted line is the released contextual-orchestrator boundary with virtual `orchestrator/free`. If gateway authentication, a required capability, or the released owner contract is unavailable, fail closed and repair/release the canonical owner before bumping the LifeOS consumer. Model timeout defaults remain owner-contract-driven; user cancellation, provider termination, administrative timeout, stream/tool-call lifecycle and reasoning completion are distinct evidence classes.

Deterministic pull-request checks remain meaningful when model capability is unavailable. Provider/gateway failures produce sanitized unavailable evidence, never fabricated scores or a direct-provider bypass.

## Verification standard

- Production declarations have explanatory docstrings/rustdoc.
- Owned production code maintains the repository's exact configured statement, branch, function and line/edge coverage gates; a green suite alone is not a 100% coverage claim.
- Tests model realistic domain outcomes, including PostgreSQL/browser/concurrency/security behavior where applicable. Synthetic data is unit-test evidence, not production acceptance.
- Buyer-path web/API performance is measured end-to-end on applicable real paths; an asserted p95 target is not accepted without the actual denominator and profiling evidence.
- Material UI preserves reusable component/page composition, product-design/Figma/Storybook traceability, normal/loading/empty/error/permission/responsive/interaction states, keyboard/a11y evidence and KO/EN/JA/ZH/VI/ES/DE/FR locale behavior where the changed surface requires it.
- Standards and research claims are documented with APA 7 references and publication status is distinguished from drafts or preprints.
- Canonical status fields use the exact repository vocabulary and never mix PR/issue qualifiers into the status value.
- `CHANGELOG.md` records buyer-visible behavior and meaningful security/operational contract changes.
- PRD/TRD/Architecture/ADR/UML/Data Model/API/Security/Privacy/Test/Operability/Release/Traceability views are reconciled when their boundary changes.
- Exact source, PR-base snapshot, live base, integration/synthetic tree, workflow checkout, protected main and release-source identities are never conflated.
- Release tags and versions are created only after the repository proves release readiness; unreleased work stays under `Unreleased`.

## Safe escalation

Escalate only for a decision or permission that cannot be resolved from repository policy, tests, standards, or available credentials. Waiting for checks or reviews is not itself an escalation condition; continue independent analysis, documentation, testing, restacking, owner-path repair, or the next non-conflicting planned task while preserving merge safety.
