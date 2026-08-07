# Claude operating contract for LifeOS

`AGENTS.md` is the canonical repository-wide instruction file. This document maps that contract into a concise execution order for Claude-compatible agents and must not override `AGENTS.md`, `ARCHITECTURE.md`, branch protection, or security policy.

## Execution order

1. Inspect every open pull request before starting unrelated implementation.
2. Read all human, CodeRabbit, AppGuardrail, code-scanning, and security feedback.
3. Determine the root cause of every failing or pending-required check.
4. Make the smallest complete correction, including tests and documentation.
5. Re-run the exact pull-request head and resolve only threads whose finding is actually addressed.
6. Merge only when required checks pass, no actionable findings remain, and the repository's merge policy accepts the exact head.
7. Continue with the highest-impact buyer-visible gap after the pull-request queue is empty.

Routine progress narration is not a substitute for repository evidence. Record decisions in code, tests, ADRs, specifications, plans, runbooks, issues, and pull-request descriptions.

## Non-negotiable boundaries

- Never use `COPILOT_GITHUB_TOKEN`.
- Scheduled model-assisted work uses `NVIDIA_NIM_API_KEY` through the approved OpenCode or contextual-orchestrator boundary.
- Do not alter or repurpose the credential scheme of existing review agents.
- Never forward browser cookies, provider credentials, hidden reasoning, raw prompts, raw model responses, or stack traces into retained artifacts.
- Internal identifiers are UUIDv4 strings; numeric external identifiers are mapped through an explicit provider-identity boundary.
- Database objects use multiword `snake_case` names unless an external protocol mandates a different spelling.
- Services do not read or mutate another service's database tables.
- AI proposals remain inert until a separately authorized user-confirmed execution capability exists.
- Mathematical and psychometric numerical kernels require Rust, deterministic CPU/GPU execution boundaries, realistic parameter-recovery tests, multilevel or multiple-membership structure, and temporal modeling where applicable.

## LLM orchestration decisions

Use a strong single-model route as the mandatory baseline. Allocate additional test-time compute only through explicit profiles that identify reasoning effort, workflow stages, role assignment, decomposition, recursive depth, and access topology. Use measured proposal validity, grounding, utility, and prompt-injection resistance to justify deeper orchestration. Do not optimize this decision for latency alone.

Live model tests may use `NVIDIA_NIM_API_KEY`. Deterministic pull-request checks must remain meaningful when that secret or the provider is unavailable. Provider failures produce sanitized unavailable evidence, never fabricated scores.

## Verification standard

- Production declarations have explanatory docstrings.
- Changed production code maintains 100% statement, branch, function, and line coverage where the package enforces those gates.
- Tests model realistic domain outcomes, not only mocked implementation calls.
- Standards and research claims are documented with APA 7 references and publication status is distinguished from drafts or preprints.
- `CHANGELOG.md` records buyer-visible behavior.
- `ARCHITECTURE.md` and relevant feature ADR/specification files record boundary changes.
- Release tags and versions are created only after the repository proves release readiness; unreleased work stays under `Unreleased`.

## Safe escalation

Escalate only for a decision or permission that cannot be resolved from repository policy, tests, standards, or available credentials. Waiting for checks or reviews is not itself an escalation condition; continue independent analysis, documentation, or the next non-conflicting planned task while preserving merge safety.
