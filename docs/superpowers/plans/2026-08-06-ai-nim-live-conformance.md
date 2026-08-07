# NVIDIA NIM Live Proposal Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an hourly, opt-in NVIDIA NIM live-conformance matrix that reuses the production LifeOS proposal evaluator and compares a strong routed model against bounded contextual-orchestrator workflows without exposing provider credentials or making stochastic availability a pull-request gate.

**Architecture:** A new AI-service live model calls one loopback contextual-orchestrator server and retains only bounded orchestration measurements. A report composer runs the existing `ProposalQualityEvaluator` once per supported profile, calculates deltas from `route_high`, and emits a versioned credential-free artifact. A GitHub Actions workflow pins contextual-orchestrator, seeds the NVIDIA key into an ephemeral PostgreSQL KV through stdin, starts the local service, runs the compiled LifeOS command, validates the report, and uploads only the final report.

**Tech Stack:** TypeScript 5.9, Node.js 22, Vitest/V8 coverage, Nest build tooling, GitHub Actions, Python 3.13, contextual-orchestrator at an immutable SHA, PostgreSQL 16 with pgcrypto, NVIDIA NIM OpenAI-compatible chat completions.

## Global Constraints

- The workflow must never reference `COPILOT_GITHUB_TOKEN`.
- Only the credential-seeding step may receive `NVIDIA_NIM_API_KEY`.
- The external orchestrator checkout must equal `6841b71935e0b7cb98fb52bcb4709cc5100c8d87` before install or provider egress.
- Normal pull-request checks remain deterministic and require no NVIDIA credential or external model.
- Every new AI-service production statement, branch, function, and line must remain at 100% coverage.
- Every exported production function, interface, type, and class must have explanatory JSDoc.
- Retained evidence must exclude raw prompts, proposal text, rationales, operation descriptions, model responses, trace outputs, credentials, bearer tokens, hidden reasoning, provider bodies, and stack traces.
- Object identifiers must be bounded opaque strings; integers are allowed only as measurements or counts.
- No database object is added to LifeOS. The ephemeral orchestrator KV retains its existing two-word `provider_credentials` table.
- The workflow must use read-only GitHub token permissions and repository-scoped single-flight concurrency.
- The live matrix is quality-first; latency is measured but is not the optimization objective.

---

### Task 1: Share the proposal draft transport contract

**Files:**

- Modify: `apps/ai-service/src/contextual-orchestrator-proposal-model.ts`
- Create: `apps/ai-service/src/contextual-orchestrator-proposal-contract.test.ts`
- Modify: `apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts`

**Interfaces:**

- Produces: `CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SYSTEM_INSTRUCTION`
- Produces: `CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA`
- Produces: `parseContextualOrchestratorProposalCompletion(text: string): ProposalModelDraft`

- [ ] **Step 1: Write failing exports and parser-contract tests**

Add contract tests in `contextual-orchestrator-proposal-contract.test.ts` that import the three public symbols, assert the system instruction remains inert, assert the schema allows only the three proposal operation families, and assert the parser accepts one exact completion envelope while rejecting malformed JSON, missing choices, empty content, and non-object content with `ProposalModelTransportError`. Keep transport behavior coverage in `contextual-orchestrator-proposal-model.test.ts`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @life-os/ai-service exec vitest run src/contextual-orchestrator-proposal-contract.test.ts src/contextual-orchestrator-proposal-model.test.ts --no-file-parallelism
```

Expected: TypeScript or assertion failure because the shared symbols are not exported.

- [ ] **Step 3: Export the existing contract without changing production behavior**

Rename and export the existing constants and parser. Keep `ContextualOrchestratorProposalModel.generate()` calling the exported parser. Do not loosen origin, token, timeout, redirect, byte-limit, UTF-8, or schema validation.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the same two-file command. Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/ai-service/src/contextual-orchestrator-proposal-model.ts apps/ai-service/src/contextual-orchestrator-proposal-contract.test.ts apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts
git commit -m "refactor(ai): share proposal model contract"
```

### Task 2: Add the loopback live-conformance model

**Files:**

- Create: `apps/ai-service/src/contextual-orchestrator-live-model.ts`
- Create: `apps/ai-service/src/contextual-orchestrator-live-model.test.ts`

**Interfaces:**

- Consumes: shared proposal instruction, schema, and parser from Task 1.
- Produces: `LiveConformanceProfile`
- Produces: `LiveConformanceObservation`
- Produces: `ContextualOrchestratorLiveProposalModel implements ProposalModel`
- Produces: `createContextualOrchestratorLiveConfiguration(environment, profile)`

- [ ] **Step 1: Write profile and security-boundary tests**

Cover:

```ts
const routeHigh = {
  profileId: 'route_high',
  mode: 'route',
  structuredOutput: true,
  reasoningEffort: 'high',
} as const;
```

Assert that configuration accepts only an exact `http://127.0.0.1:<1-65535>` origin and a 32–4096-byte token, rejects credentials/path/query/fragment/other hosts/control bytes, and snapshots the profile immutably.

- [ ] **Step 2: Write request-shape tests**

For `route_high`, assert the body contains `response_format`, `reasoning_effort: "high"`, `orchestration_mode: "route"`, no tools, and `include_orchestration_trace: true`.

For `conduct_template`, assert the body contains `orchestration_mode: "conduct"`, omits provider-native `response_format` and `reasoning_effort`, and preserves the same inert instruction and validated user request.

- [ ] **Step 3: Write response and redaction tests**

Return a mock completion envelope with top-level orchestration metadata and a trace containing secret-shaped outputs. Assert the model returns only the parsed draft and records a frozen observation containing counts, role names, agent-count, access-edge/fan-in measurements, bounded usage, latency, plan source, verifier classification, and no raw output, subtask, model name, workflow ID, token, or secret.

Cover non-2xx, redirect, null body, oversized body, invalid UTF-8, malformed envelope, invalid trace, unsafe counters, and fetch rejection as stable credential-free failures.

- [ ] **Step 4: Run the focused test and verify RED**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/contextual-orchestrator-live-model.test.ts --no-file-parallelism
```

Expected: module-not-found failure.

- [ ] **Step 5: Implement the bounded model and observation parser**

Use a 65,536-byte response cap, fatal UTF-8, `redirect: "error"`, `AbortSignal.timeout`, exact loopback validation, and `performance.now()` or an injectable monotonic clock. Normalize trace metadata into measurements only. Never retain `trace[].output`, `subtask`, workflow identifiers, raw access arrays, model identifiers, or response bodies.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the same command. Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/ai-service/src/contextual-orchestrator-live-model.ts apps/ai-service/src/contextual-orchestrator-live-model.test.ts
git commit -m "feat(ai): add bounded live conformance model"
```

### Task 3: Compose the immutable live-conformance report

**Files:**

- Create: `apps/ai-service/src/proposal-quality-live-conformance.ts`
- Create: `apps/ai-service/src/proposal-quality-live-conformance.test.ts`

**Interfaces:**

- Consumes: `ProposalQualityEvaluator`, default fixtures, suite version, and Task 2 model.
- Produces: `LIVE_CONFORMANCE_SCHEMA = "life-os.ai-proposal-live-conformance.v1"`
- Produces: `ProposalLiveConformanceReport`
- Produces: `runProposalLiveConformance(options): Promise<ProposalLiveConformanceReport>`
- Produces: `validateProposalLiveConformanceReport(value)`

- [ ] **Step 1: Write report-schema and validation tests**

Require exact lowercase 40-character LifeOS and orchestrator SHAs, one RFC 3339 UTC timestamp, fixed provider label `nvidia_nim_hosted`, a SHA-256 inventory digest, model count from 1 through 4, unique bounded profile IDs, one `route_high` baseline, and no unknown keys.

- [ ] **Step 2: Write available-profile evaluation tests**

Use scripted Fetch responses for all seven fixtures. Prove that `route_low`, `route_high`, and `conduct_template` each run the exact `DEFAULT_PROPOSAL_EVALUATION_FIXTURES` through the production evaluator and retain the evaluator's immutable report without proposal content.

- [ ] **Step 3: Write delta and decision tests**

Assert deltas are computed only against `route_high` for valid-proposal, operation-conformance, target-grounding, benign-utility, and prompt-injection-resistance rates. Null denominators remain null. Recommendation rules must never prefer conduct when operation conformance or prompt-injection resistance regresses.

- [ ] **Step 4: Write unavailable-cell tests**

Cover `missing_provider_credential`, `missing_model_inventory`, `orchestrator_unavailable`, `provider_unavailable`, `unsupported_by_pinned_orchestrator`, `insufficient_model_inventory`, and `evaluation_failed`. Unsupported profiles contain no rates or fabricated evaluator report.

- [ ] **Step 5: Write artifact-redaction tests**

Serialize the final report and assert it contains none of the fixture objectives, context titles, proposal summaries, rationales, operation descriptions, model identifiers, bearer tokens, credential names' values, `choices`, `messages`, `trace.output`, or stack strings.

- [ ] **Step 6: Run the focused test and verify RED**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/proposal-quality-live-conformance.test.ts --no-file-parallelism
```

Expected: module-not-found failure.

- [ ] **Step 7: Implement profile execution, aggregation, validation, and freezing**

Use deterministic evaluator workspace/proposal UUIDv4 values and one injected evaluation clock. Generate unique deterministic proposal IDs per profile without numeric object identifiers. Hash the sorted explicit model inventory and discard model strings before report construction.

- [ ] **Step 8: Run the focused test and verify GREEN**

Run the same command. Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add apps/ai-service/src/proposal-quality-live-conformance.ts apps/ai-service/src/proposal-quality-live-conformance.test.ts
git commit -m "feat(ai): compose live conformance evidence"
```

### Task 4: Add the compiled command boundary

**Files:**

- Create: `apps/ai-service/src/proposal-quality-live-command.ts`
- Create: `apps/ai-service/src/proposal-quality-live-command.test.ts`
- Create: `apps/ai-service/src/proposal-quality-live-cli.ts`
- Create: `apps/ai-service/src/proposal-quality-live-cli.test.ts`
- Modify: `apps/ai-service/package.json`

**Interfaces:**

- Produces: `runProposalQualityLiveCommand(environment, dependencies)`
- Produces package script: `quality:live`

- [ ] **Step 1: Write environment and output tests**

Validate `CONTEXTUAL_ORCHESTRATOR_LIVE_URL`, `CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN`, `LIFE_OS_COMMIT_SHA`, `CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA`, `NVIDIA_NIM_CHAT_MODELS`, `PROPOSAL_LIVE_REPORT_PATH`, and `AI_NIM_LIVE_CONFORMANCE_ENABLED`. Missing enablement, secret-availability marker, or model inventory must write a valid explicit no-result report and make no Fetch call.

- [ ] **Step 2: Write atomic-publication tests**

Write to a sibling temporary file with `mode: 0o600`, validate the complete report, then rename to the final path. Any generation, validation, write, or rename failure must remove the temporary file and preserve an existing final report byte-for-byte.

- [ ] **Step 3: Write CLI bootstrap test**

Mock `runProposalQualityLiveCommand`, import `proposal-quality-live-cli.ts`, and assert it invokes the command exactly once. Cover the rejection path without logging nested error details.

- [ ] **Step 4: Run focused tests and verify RED**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/proposal-quality-live-command.test.ts src/proposal-quality-live-cli.test.ts --no-file-parallelism
```

Expected: module-not-found failures.

- [ ] **Step 5: Implement command and CLI**

The command owns environment parsing and atomic publication. The CLI catches only at the process boundary, writes a fixed credential-free error message, and sets `process.exitCode = 1`.

- [ ] **Step 6: Add the package command**

Add:

```json
"quality:live": "node dist/proposal-quality-live-cli.js"
```

Keep `build`, `lint`, `test`, `typecheck`, and runtime commands unchanged.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the same command. Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/ai-service/src/proposal-quality-live-* apps/ai-service/package.json
git commit -m "feat(ai): add live conformance command"
```

### Task 5: Add the immutable hourly GitHub Actions workflow

**Files:**

- Create: `.github/workflows/ai-proposal-live-conformance.yml`
- Create: `apps/ai-service/src/proposal-quality-live-workflow.test.ts`

**Interfaces:**

- Consumes: `NVIDIA_NIM_API_KEY`, `NVIDIA_NIM_CHAT_MODELS`, and the Task 4 command.
- Produces: hourly/manual artifact `ai-proposal-live-conformance-<run_id>`.

- [ ] **Step 1: Write workflow-contract tests**

Parse the workflow as text and assert:

- hourly cron at minute 47;
- manual dispatch with optional model-list input;
- read-only top-level permissions;
- repository-scoped single-flight concurrency;
- exact action SHAs for checkout, setup-node, setup-python, and upload-artifact;
- exact contextual-orchestrator commit constant;
- exact provider origin and allowlist;
- no `COPILOT_GITHUB_TOKEN` text;
- `NVIDIA_NIM_API_KEY` appears only in the one credential-seeding step;
- pinned checkout SHA is verified before installation;
- credential is piped to `register-credential --value-stdin`;
- provider key is absent from server and LifeOS runner steps;
- only the validated report path is uploaded;
- no orchestrator log or temporary model response path is uploaded.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/proposal-quality-live-workflow.test.ts --no-file-parallelism
```

Expected: missing-workflow failure.

- [ ] **Step 3: Implement deterministic contract and live jobs**

The deterministic job installs frozen Node dependencies and runs the focused workflow/report tests without secrets. The live job runs only for hourly/manual main-branch events, uses PostgreSQL 16 with pgcrypto, installs the pinned orchestrator with its `db` extra, generates an ephemeral KV passphrase and inference token, validates one-to-four explicit model IDs, seeds the provider credential through stdin, starts the loopback server, waits on `/healthz`, builds AI service, executes `quality:live`, validates the report, and uploads it for 14 days.

- [ ] **Step 4: Add bounded no-result behavior**

When `AI_NIM_LIVE_CONFORMANCE_ENABLED` is not `true`, the provider secret is absent, or the model list is empty, call the LifeOS command in no-result mode and still upload a valid report. Do not install or contact contextual-orchestrator in those cells.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same command. Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ai-proposal-live-conformance.yml apps/ai-service/src/proposal-quality-live-workflow.test.ts
git commit -m "ci(ai): add hourly NVIDIA NIM conformance"
```

### Task 6: Update architecture, operating guidance, research, and release evidence

**Files:**

- Modify: `AGENTS.md`
- Create: `ARCHITECTURE.md`
- Create: `CLAUDE.md`
- Create: `docs/operations/ai-proposal-live-conformance.md`
- Create: `docs/research/2026-08-06-ai-live-conformance-orchestration.md`
- Modify: `docs/operations/contextual-orchestrator-proposal-transport.md`
- Modify: `CHANGELOG.md`
- Modify: `product/capabilities.json`
- Modify: `apps/ai-service/package.json`
- Modify: `package.json`

**Interfaces:**

- Produces reviewed ADR and operator evidence for #116.

- [ ] **Step 1: Update agent guidance**

Record that provider keys enter only through contextual-orchestrator's KV bootstrap, `COPILOT_GITHUB_TOKEN` is prohibited, live provider results are dated non-gating evidence, and the production evaluator remains the single scoring source of truth.

- [ ] **Step 2: Add architecture diagrams**

Create `ARCHITECTURE.md` with the MSA dependency graph, signed browser-to-AI boundary, AI-to-orchestrator boundary, ephemeral live-evaluation boundary, secret flow, and no-execution invariant. Use Mermaid diagrams and exact file/service names.

- [ ] **Step 3: Add assistant-specific repository guidance**

Create `CLAUDE.md` that points to `AGENTS.md`, forbids bypassing exact-head checks, requires immutable external pins, and describes how to add future live profiles without retaining raw model data.

- [ ] **Step 4: Write the runbook**

Document enablement variables, manual dispatch, hourly schedule, call budget, PostgreSQL KV, model inventory, artifact interpretation, recommendation rule, failure classes, disablement, incident response, and pin-update procedure.

- [ ] **Step 5: Write APA 7 research doctoring**

Separate source-supported claims from LifeOS design inferences. Cite NVIDIA NIM API documentation, Fugu, Conductor, TRINITY, and the 2026 strong-single-agent baseline. State that the seven-fixture suite cannot prove general superiority, fairness, or production reliability.

- [ ] **Step 6: Update changelog and capability evidence**

Add an `Unreleased` AI quality entry. Extend `ai.auditable-proposals` evidence with the live report composer, workflow-contract test, runbook, and research record. Do not claim a live pass before an actual artifact exists.

- [ ] **Step 7: Add every new source and document to formatting gates**

Update AI-service lint and root `format:check` without removing any existing path. Prefer bounded glob groups when they preserve the current reviewed set.

- [ ] **Step 8: Format and verify docs**

```bash
pnpm exec prettier --single-quote --write AGENTS.md ARCHITECTURE.md CLAUDE.md CHANGELOG.md product/capabilities.json package.json apps/ai-service/package.json docs/operations/ai-proposal-live-conformance.md docs/operations/contextual-orchestrator-proposal-transport.md docs/research/2026-08-06-ai-live-conformance-orchestration.md docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md docs/superpowers/plans/2026-08-06-ai-nim-live-conformance.md
pnpm format:check
```

Expected: formatting passes.

- [ ] **Step 9: Commit**

```bash
git add AGENTS.md ARCHITECTURE.md CLAUDE.md CHANGELOG.md product/capabilities.json package.json apps/ai-service/package.json docs
git commit -m "docs(ai): record live conformance architecture"
```

### Task 7: Run complete verification and open the pull request

**Files:**

- No new files unless verification exposes a concrete defect.

**Interfaces:**

- Produces exact-head merge evidence for #116.

- [ ] **Step 1: Run complete AI-service verification**

```bash
pnpm --filter @life-os/ai-service lint
pnpm --filter @life-os/ai-service typecheck
pnpm --filter @life-os/ai-service test
pnpm --filter @life-os/ai-service build
```

Expected: all pass and V8 reports 100% statements, branches, functions, and lines.

- [ ] **Step 2: Run repository verification**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all pass.

- [ ] **Step 3: Verify secret and identifier invariants**

```bash
! git grep -n 'COPILOT_GITHUB_TOKEN'
git grep -n 'NVIDIA_NIM_API_KEY' -- .github/workflows/ai-proposal-live-conformance.yml docs AGENTS.md ARCHITECTURE.md CLAUDE.md
```

Expected: no Copilot token reference; NVIDIA key references are limited to documented bootstrap and the one workflow seed step.

- [ ] **Step 4: Open a draft pull request**

Use title:

```text
feat(ai): add NVIDIA NIM live proposal conformance
```

The body must list buyer outcome, exact contextual-orchestrator pin, profile matrix, unsupported cells, security boundary, deterministic verification, APA 7 research, and `Closes #116`.

- [ ] **Step 5: Review and repair every exact-head finding**

Inspect CI, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, GHAS, and human review. Reproduce each concrete failure, fix root cause, rerun exact-head checks, and resolve only addressed threads.

- [ ] **Step 6: Mark Ready only after implementation is complete**

No required deterministic check may be pending or failing. Live-provider success is not required; workflow and report-contract correctness are required.

- [ ] **Step 7: Squash-merge by exact head**

Merge only when the exact current head has all required checks successful and no unresolved actionable review. Then verify the merge commit on `main` and close #116 through the PR body.
