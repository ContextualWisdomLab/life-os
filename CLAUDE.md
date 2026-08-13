# Claude operating contract for LifeOS

`AGENTS.md` is the canonical repository-wide instruction file. `ARCHITECTURE.md` is the durable system-boundary source of truth. The canonical product documentation graph is indexed from `README.md` and includes PRD, TRD, ADRs, Data Model, UML, API contracts, threat/privacy/test/operability/release/standards/traceability views. This document maps those authorities into a concise execution order for Claude-compatible agents and must not override live repository policy.

## Execution order

1. Inspect every open pull request before starting unrelated implementation.
2. Read all human, CodeRabbit, AppGuardrail, code-scanning, and security feedback.
3. Determine the root cause of every failing or pending-required check.
4. Make the smallest complete correction, including tests and documentation.
5. Re-run the exact pull-request head and resolve only threads whose finding is actually addressed.
6. Merge only when required checks pass, no actionable findings remain, and the repository's merge policy accepts the exact head.
7. Continue with the highest-impact buyer-visible gap after the pull-request queue is empty or a current lane becomes locally blocked.

Routine progress narration is not a substitute for repository evidence. Record durable decisions in canonical docs/ADRs, code, tests, runbooks, issues, and pull-request evidence with truthful protected-main/active-PR/planned maturity.

## Non-negotiable boundaries

- Never use `COPILOT_GITHUB_TOKEN`.
- Scheduled model-assisted work uses `NVIDIA_NIM_API_KEY` through the approved OpenCode or contextual-orchestrator boundary.
- Do not alter or repurpose the credential scheme of existing review agents.
- Never forward browser cookies, provider credentials, hidden reasoning, raw prompts, raw model responses, or stack traces into retained artifacts.
- Internal identifiers are UUIDv4 strings; numeric external identifiers are mapped through an explicit provider-identity boundary.
- Database objects use multiword `snake_case` names unless an external protocol mandates a different spelling.
- Services do not read or mutate another service's database tables.
- Browser-local state is not durable until accepted by the owning service.
- AI proposals remain inert until a separately authorized user-confirmed execution capability exists.
- Sensitive access is tenant/resource/purpose/lifetime/audit bound rather than relying on blanket masking.
- Mathematical and psychometric numerical kernels require Rust, deterministic CPU/GPU execution boundaries, realistic parameter-recovery tests, multilevel or multiple-membership structure, and temporal modeling where applicable.

## LLM orchestration decisions

Use a strong single-model route as the mandatory baseline. Allocate additional test-time compute only through explicit profiles that identify reasoning effort, workflow stages, role assignment, decomposition, recursive depth, and access topology. Use measured proposal validity, grounding, utility, and prompt-injection resistance to justify deeper orchestration. Do not optimize this decision for latency alone.

Live model tests may use `NVIDIA_NIM_API_KEY`. Deterministic pull-request checks must remain meaningful when that secret or the provider is unavailable. Provider failures produce sanitized unavailable evidence, never fabricated scores.

## Verification standard

- Production declarations have explanatory docstrings.
- Changed production code maintains 100% statement, branch, function, and line coverage where the package enforces those gates.
- Tests model realistic domain outcomes, including PostgreSQL/browser/concurrency/security behavior where applicable.
- Standards and research claims are documented with APA 7 references and publication status is distinguished from drafts or preprints.
- Canonical status fields use the exact repository vocabulary and never mix PR/issue qualifiers into the status value.
- `CHANGELOG.md` records buyer-visible behavior.
- PRD/TRD/Architecture/ADR/UML/Data Model/API/Security/Privacy/Test/Operability/Release/Traceability views are reconciled when their boundary changes.
- Release tags and versions are created only after the repository proves release readiness; unreleased work stays under `Unreleased`.

## Safe escalation

Escalate only for a decision or permission that cannot be resolved from repository policy, tests, standards, or available credentials. Waiting for checks or reviews is not itself an escalation condition; continue independent analysis, documentation, testing, or the next non-conflicting planned task while preserving merge safety.
