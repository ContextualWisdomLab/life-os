# LifeOS agent contract

This file is the canonical repository-wide operating contract for coding agents. `ARCHITECTURE.md` defines durable system boundaries, while feature specifications, implementation plans, and runbooks provide scoped detail.

## Pull-request loop

For every open pull request:

1. inspect the exact current head;
2. read every human, CodeRabbit, AppGuardrail, code-scanning, and security finding;
3. diagnose the root cause of failed or required checks;
4. make a complete correction with tests and documentation;
5. rerun or wait for checks on the corrected exact head while continuing independent work;
6. resolve only review threads whose underlying issue is addressed;
7. merge only when all required evidence passes and no actionable review finding remains;
8. continue with the next buyer-visible development slice.

Never use an administrative bypass or claim completion from stale checks. Routine progress narration is not repository evidence.

## Code-owner review gates — disabled on hold

As of 2026-08-04, code-owner review requirements (`require_code_owner_reviews` in branch protection and `require_code_owner_review` in rulesets) are disabled across the ContextualWisdomLab organization because there is one maintainer and that gate cannot be satisfied. Do not re-enable CODEOWNERS-based merge gates until the organization has multiple maintainers. Independent automated review, security checks, and exact-head verification remain required where configured.

## Modular MSA rules

- Every bounded service must run independently and remain composable in the LifeOS monorepo deployment.
- Services communicate through versioned HTTP, event, saga, plugin, or MCP contracts.
- A service must not read or mutate another service's database tables.
- Each service owns migrations, runtime configuration, observability, tests, and shutdown behavior.
- Internal identifiers are opaque UUIDv4 strings. Numeric provider identifiers never become internal primary keys.
- Database objects use names containing at least two words, preferably `snake_case`, unless an external protocol mandates another form.
- Rename stale internal product or caller names when they no longer match the public software identity.

## Quality and documentation

- Production declarations require explanatory docstrings sufficient for a new contributor to understand the contract without reconstructing the implementation.
- Packages that enforce coverage gates must retain 100% statement, branch, function, and line coverage.
- Tests prove realistic domain accuracy and failure behavior, not only mocked call counts.
- Standards, papers, and research claims are recorded in `docs/research/` or the approved feature specification with APA 7 references and clear final/draft/preprint status.
- Update `ARCHITECTURE.md`, `CLAUDE.md`, `CHANGELOG.md`, capability evidence, design specifications, implementation plans, and operating runbooks when their boundary changes.
- A release version and tag are created only when the repository proves release readiness; otherwise changes remain under `CHANGELOG.md` → `Unreleased`.

## AI and model-provider rules

- AI proposals are inert, explainable suggestions and cannot silently mutate user-owned data.
- `COPILOT_GITHUB_TOKEN` is prohibited.
- Model-assisted tests and scheduled agents use `NVIDIA_NIM_API_KEY` through the approved OpenCode or contextual-orchestrator boundary.
- Do not alter or reuse the key scheme of existing review agents.
- Provider credentials, browser cookies, bearer material, raw prompts, raw responses, hidden reasoning, and stack traces do not enter retained artifacts.
- Live-provider availability is not a deterministic pull-request merge requirement; missing or unavailable providers produce explicit sanitized evidence.

### Test-time compute allocation

A strong single-model route is the mandatory baseline. Deeper orchestration is justified only by measured quality or heterogeneous capability coverage. Explicitly model and ablate:

- reasoning effort;
- workflow stages;
- planner, worker, verifier, and synthesizer roles;
- task decomposition;
- recursive depth;
- access lists and communication topology;
- homogeneous versus heterogeneous model pools.

Fugu, Conductor, TRINITY, and strong-single-agent evidence guide the design, but repository tests and retained measurements determine the deployed policy. Latency is recorded but is not the sole or primary decision criterion.

## Mathematical and psychometric modules

Any future mathematical or psychometric computation layer must:

- implement numerical kernels in Rust;
- support deterministic CPU multithreading with low context switching and a GPU execution boundary;
- test true-parameter recovery, bias, interval coverage, convergence, and RMSE on realistic simulations;
- model multilevel and multiple-membership structure to avoid atomistic fallacy;
- model temporal change, repeated measurement, drift, or state evolution where the estimand changes over time;
- document assumptions, estimands, numerical precision, fallback behavior, and reproducibility controls with APA 7 references.

## Security and privacy

- Treat every external response, stored JSON value, environment value, model output, and connector result as untrusted until bounded and validated.
- Keep SQL structure static and parameterize dynamic values.
- Fail closed on malformed ownership, identifiers, signatures, digests, timestamps, pagination, or provider configuration.
- Public problems, metrics, logs, and artifacts are credential-free and bounded.
- Temporary write-capable repair workflows must be removed before merge; persistent workflows receive the least permissions needed.

## Waiting and escalation

Waiting for checks, reviews, or a long-running OpenCode agent is not a blocker. Continue non-conflicting analysis, documentation, testing, or the next planned slice. Escalate only when a product decision or permission cannot be derived from repository policy, evidence, standards, or available tools.
