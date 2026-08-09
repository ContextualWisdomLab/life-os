# LifeOS agent contract

This file is the canonical repository-wide operating contract for coding agents. `ARCHITECTURE.md` defines durable system boundaries; canonical whole-product documents define current product/technical/data/security/release truth; feature specifications, plans and runbooks provide scoped detail.

## Work-conserving execution

A commit, PR update, merge, RCA, documentation change, queued check or buyer-slice completion is an intermediate result while another safe LifeOS action remains. After each action or defer decision, refetch enough live state to select the next highest-value executable item. Waiting on one PR/check/reviewer/provider blocks only that lane.

Before ending an invocation, perform a fresh sweep of open PRs/issues, protected main, canonical docs, tests/security/privacy/accessibility, migrations/recovery, release evidence and buyer-visible gaps. The hourly recurrence continues work after finite invocation/tool budget exhaustion; it is not a reason to stop after one useful action.

## Pull-request loop

For every open pull request:

1. refetch the exact current contributor head and independently resolve the live base tip;
2. read human, CodeRabbit, AppGuardrail, code-scanning, security and other current feedback;
3. identify the exact checked-out commit/tree for every check before treating it as evidence;
4. diagnose the root cause of failed, missing or required checks;
5. establish a realistic regression/acceptance boundary and make the smallest complete correction;
6. rerun/inspect the corrected exact head while continuing unrelated safe work;
7. resolve only review threads whose underlying issue is addressed;
8. merge only when actual repository policy accepts the unchanged head and no actionable finding remains;
9. refetch the queue and continue.

Never promote stale/predecessor/synthetic-merge-only/queued/cancelled/absent evidence to exact-head success. Routine progress narration is not repository evidence.

## Code-owner review gates — disabled on hold

As of 2026-08-04, code-owner review requirements (`require_code_owner_reviews` in branch protection and `require_code_owner_review` in rulesets) are disabled across the ContextualWisdomLab organization because there is one maintainer and that gate cannot be satisfied. Revalidate live repository/ruleset state before relying on this historical note. Independent automated review, security checks and exact-head verification remain required where configured.

## Writer lease

Before each LifeOS source/docs/ref write, refetch target head, live base, target blob/ref and relevant review state. If another source writer moves or targets the same branch, freeze only that branch for the rest of the invocation and continue elsewhere. Dedicated writer loops in other repositories are read-only dependencies from this loop.

Do not infer standing user prohibitions from historical assistant prompts. Evaluate implementation mechanisms against current repository policy, permissions, safety, reversibility, auditability and operational evidence.

## Modular MSA rules

- Every bounded service must run independently and remain composable in the LifeOS monorepo deployment.
- Services communicate through versioned HTTP, event, saga, plugin or MCP contracts.
- A service must not read or mutate another service's database tables.
- Each service owns migrations, runtime configuration, persistence credentials/adapters, observability, tests and shutdown behavior.
- Internal identifiers are opaque UUIDv4 strings. Numeric/provider identifiers never become internal primary keys.
- Database objects use names containing at least two descriptive words, preferably `snake_case`, unless an external protocol mandates another form.
- Browser-local state is labeled draft/cache/offline state until an owning service accepts it durably.
- Rename stale internal product/caller names when they no longer match the public software identity.

## Canonical documentation

GitHub must be sufficient to reconstruct the current whole product without chat archaeology. Maintain and cross-link:

- `docs/PRD.md`
- `docs/TRD.md`
- `ARCHITECTURE.md`
- `docs/adr/README.md` and ADRs
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

Canonical status fields use exactly `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, or `Out of scope`. Put issue/PR numbers and qualifiers in evidence/notes, not inside status values.

File existence or a historically resolved review comment is not semantic correctness. Compare documentation with current protected-main source/migrations/workflows and live active PRs/issues. If a docs branch materially diverges from protected main, preserve/reconcile its unique durable content onto one clean current-main successor, verify preservation/currentness, then close the obsolete docs PR as superseded.

Documentation completion is not a product-completion condition. Convert documentation-discovered gaps into source/tests/migrations/API/UX work in the same invocation when safe.

## Quality and documentation

- Production declarations require explanatory docstrings sufficient for a new contributor to understand the contract without reconstructing implementation internals.
- Packages that enforce exact coverage gates retain meaningful 100% statement, branch, function and line coverage.
- Tests prove realistic domain accuracy and failure behavior, not only mocked call counts.
- Standards, papers and research claims are recorded in `docs/research/` or the relevant canonical/scoped specification with APA 7 references and publication status.
- Update canonical product/architecture/data/security/test/operability/release docs whenever their boundary changes.
- A release version/tag is created only when one exact protected integrated head proves release readiness; otherwise work remains `Unreleased`.

## AI and model-provider rules

- AI proposals are inert, explainable suggestions and cannot silently mutate user-owned data.
- `COPILOT_GITHUB_TOKEN` is not a development-model credential for LifeOS autonomous development.
- Model-assisted tests and scheduled development use `NVIDIA_NIM_API_KEY` through the approved OpenCode or contextual-orchestrator boundary where required by the current credential contract.
- Do not alter or reuse the key scheme of independent review agents casually.
- Provider credentials, browser cookies, bearer material, raw prompts, raw responses, hidden reasoning and stack traces do not enter retained public artifacts.
- Live-provider availability is not fabricated into a deterministic pull-request pass; unavailable providers produce explicit sanitized evidence.

### Test-time compute allocation

A strong single-model route is the mandatory baseline. Deeper orchestration is justified only by measured quality or heterogeneous capability coverage. Explicitly model and ablate reasoning effort, workflow stages, roles, decomposition, recursive depth and communication/access topology. Repository tests and retained measurements determine deployed policy; latency is recorded but is not the sole decision criterion.

## Mathematical and psychometric modules

Any future mathematical or psychometric computation layer must:

- implement production numerical kernels in Rust;
- support deterministic CPU multithreading with low context switching and a GPU execution boundary where justified;
- test true-parameter recovery, bias, interval coverage, convergence and RMSE on realistic simulations;
- model multilevel/multiple-membership and temporal structure where applicable;
- document assumptions, estimands, numerical precision, fallback behavior and reproducibility controls with APA 7 references.

## Security and privacy

- Treat every external response, stored JSON value, environment value, model output and connector result as untrusted until bounded and validated.
- Keep SQL structure static and parameterize dynamic values.
- Fail closed on malformed ownership, identifiers, signatures, digests, timestamps, pagination or provider configuration.
- Public problems, metrics, logs and retained artifacts are credential-free and bounded.
- Purpose-bound sensitive access, recent-authentication and data-rights receipt evidence remain explicit rather than inferred from session age or broad membership.

## Waiting and escalation

Waiting for checks, reviews, provider availability or a long-running agent is not a whole-run blocker. Continue non-conflicting review, RCA, documentation, testing, buyer-gap implementation preparation or another branch. Escalate only when a specific decision/permission cannot be resolved from live repository policy, evidence, standards or available tools and no other safe productive work remains.