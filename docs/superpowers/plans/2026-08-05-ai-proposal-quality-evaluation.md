# AI Proposal Quality Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure proposal validity, semantic operation conformance, grounding, benign utility, and prompt-injection resistance with deterministic tests plus an opt-in NVIDIA NIM conformance workflow through contextual-orchestrator.

**Architecture:** Keep `ProposalService` as the authoritative model-output validator. Add a pure evaluator over immutable proposals and labeled fixtures, then reuse the existing `ContextualOrchestratorProposalModel` in a workflow-only live runner. Deterministic checks remain mandatory; external model availability remains opt-in evidence.

**Tech Stack:** TypeScript 5.9, Node.js 22/24 Fetch and AbortSignal APIs, Vitest 3 with V8 100% coverage, GitHub Actions, Python 3.13, PostgreSQL 16 pgcrypto KV, contextual-orchestrator pinned commit, NVIDIA NIM OpenAI-compatible chat completions.

## Global Constraints

- No evaluator receives a write-capable dependency or executes an operation.
- Reports never contain provider keys, gateway tokens, raw upstream bodies, or stack traces.
- Fixture and report fields are bounded, validated, immutable, and deterministic.
- Rates derive from integer counts; zero denominators return `null`.
- Prompt-injection resistance is reported together with benign utility.
- Structured validity and semantic correctness remain separate metrics.
- Live evaluation uses `NVIDIA_NIM_API_KEY` only as one-shot contextual-orchestrator KV bootstrap transport.
- The live workflow is `workflow_dispatch` only and has `contents: read` permissions.
- AI-service statement, branch, function, and line coverage remains exactly 100%.
- Every production function, class, interface, and error constructor has explanatory JSDoc.
- Database object names introduced by external dependencies remain two-or-more-word snake_case.

---

### Task 1: Define the evaluator contract with failing tests

**Files:**

- Create: `apps/ai-service/src/proposal-quality-evaluation.test.ts`
- Create: `apps/ai-service/src/proposal-quality-fixtures.test.ts`

**Interfaces:**

- Expected from Task 2: `ProposalQualityEvaluator`, `ProposalEvaluationFixture`, `ProposalQualityReport`, `ProposalQualityEvaluationError`, and `validateProposalEvaluationFixtures`.
- Expected from Task 3: `DEFAULT_PROPOSAL_EVALUATION_FIXTURES` and `PROPOSAL_EVALUATION_SUITE_VERSION`.

- [ ] **Step 1: Write failing report-arithmetic tests**

Use a scripted `ProposalModel` to produce valid grounded proposals, valid nonconforming proposals, malformed drafts, thrown model failures, forbidden sentinel leakage, and ungrounded target IDs. Assert exact counts and rates for mixed benign and injection cases.

- [ ] **Step 2: Write failing denominator and immutability tests**

Cover empty category denominators, no targeted operations, no forbidden-text fixtures, frozen fixtures, frozen case results, frozen reports, and stable case ordering.

- [ ] **Step 3: Write failing validation tests**

Reject empty, duplicate, oversized, malformed, unknown-category, empty allowed-kind, invalid target, target-not-in-context, empty/oversized forbidden fragment, excessive fixture, and invalid model-label inputs with one credential-free error.

- [ ] **Step 4: Write failing realistic-suite tests**

Assert the default suite contains the seven required scenarios, English and Korean text, direct and indirect injection sentinels, completed evidence, empty context, and a dated objective without any executable expectation.

- [ ] **Step 5: Verify RED**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/proposal-quality-evaluation.test.ts src/proposal-quality-fixtures.test.ts --no-file-parallelism
```

Expected: FAIL because evaluator and fixture modules do not exist.

- [ ] **Step 6: Commit the failing contract**

```bash
git add apps/ai-service/src/proposal-quality-evaluation.test.ts apps/ai-service/src/proposal-quality-fixtures.test.ts
git commit -m "test(ai): define proposal quality evaluation contract"
```

### Task 2: Implement the pure proposal quality evaluator

**Files:**

- Create: `apps/ai-service/src/proposal-quality-evaluation.ts`
- Test: `apps/ai-service/src/proposal-quality-evaluation.test.ts`

**Interfaces:**

- Consumes: `ProposalModel`, `ProposalRequest`, `ProposalOperation`, `AuditableProposal`, and `ProposalService` from `./proposal-service`.
- Produces one immutable JSON-serializable report with per-case bounded failure codes and aggregate counts/rates.

- [ ] **Step 1: Implement fixture validation**

Validate exact keys, fixture ID, category, request through `validateProposalRequest`, non-empty unique allowed kinds, optional unique required targets present in context, optional unique forbidden fragments, and suite size. Freeze every nested array and record.

- [ ] **Step 2: Implement one-case evaluation**

Run `ProposalService.generateProposal` with deterministic clock and UUID factories derived from the stable case index. Catch all model and validation failures as `proposal_unavailable` without retaining nested messages. Flatten only summary, rationale, and descriptions for forbidden-text checks using Unicode lowercase normalization.

- [ ] **Step 3: Implement semantic scoring**

A case conforms when it has 1–20 operations, every kind is allowed, every required target appears at least once, and every targeted operation points to context evidence. Track targeted and grounded operation counts separately.

- [ ] **Step 4: Implement report aggregation**

Calculate all six defined rates from integer counts. Return `null` for zero denominators. Include suite version, validated model label, evaluated UTC timestamp, total cases, category counts, bounded case results, aggregate counts, and aggregate rates.

- [ ] **Step 5: Verify GREEN and exact coverage**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/proposal-quality-evaluation.test.ts --no-file-parallelism --coverage
```

Expected: PASS with evaluator 100% statements, branches, functions, and lines.

- [ ] **Step 6: Commit the evaluator**

```bash
git add apps/ai-service/src/proposal-quality-evaluation.ts apps/ai-service/src/proposal-quality-evaluation.test.ts
git commit -m "feat(ai): add immutable proposal quality evaluator"
```

### Task 3: Add realistic versioned fixtures

**Files:**

- Create: `apps/ai-service/src/proposal-quality-fixtures.ts`
- Test: `apps/ai-service/src/proposal-quality-fixtures.test.ts`

**Interfaces:**

- Consumes `validateProposalEvaluationFixtures` from Task 2.
- Produces `PROPOSAL_EVALUATION_SUITE_VERSION = '2026-08-05.1'` and the frozen seven-case default suite.

- [ ] **Step 1: Implement stable UUID fixtures**

Use non-secret UUIDv4 values and exact scenario IDs. Do not embed scanner-shaped API keys, credentials, or personal data.

- [ ] **Step 2: Implement benign utility cases**

Add active task, completed-then-active project, empty context, Korean task, and dated milestone fixtures.

- [ ] **Step 3: Implement prompt-injection cases**

Add direct objective and indirect title attacks with unique harmless sentinels and strict allowed operation/target contracts.

- [ ] **Step 4: Verify suite tests**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/proposal-quality-fixtures.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit fixtures**

```bash
git add apps/ai-service/src/proposal-quality-fixtures.ts apps/ai-service/src/proposal-quality-fixtures.test.ts
git commit -m "test(ai): add realistic proposal evaluation fixtures"
```

### Task 4: Add the bounded live runner

**Files:**

- Create: `apps/ai-service/src/proposal-live-evaluation.ts`
- Create: `apps/ai-service/src/proposal-live-evaluation.test.ts`

**Interfaces:**

- Consumes the default fixtures, evaluator, and `ContextualOrchestratorProposalModel`.
- Produces a credential-free JSON report on stdout and a bounded non-zero exit code when thresholds fail.

- [ ] **Step 1: Write failing environment and threshold tests**

Require `GITHUB_ACTIONS=true`, exact `http://127.0.0.1:<1024-65535>` orchestrator origin, bounded inference token, bounded model label, and optional report path under `RUNNER_TEMP`. Reject every other URL and path.

- [ ] **Step 2: Implement an injectable runner**

Expose `runProposalLiveEvaluation(environment, dependencies)` for tests. Construct the existing model with the explicitly local workflow-only configuration, run the default suite, compare all hard thresholds, write one canonical JSON report, and return exit status without calling `process.exit` inside the testable core.

- [ ] **Step 3: Implement the command entry point**

Only the thin main block reads `process.env`, invokes the core, writes a fixed error code on failure, and sets `process.exitCode`. Never print nested errors or secrets.

- [ ] **Step 4: Verify GREEN and coverage**

```bash
pnpm --filter @life-os/ai-service exec vitest run src/proposal-live-evaluation.test.ts --no-file-parallelism --coverage
```

Expected: PASS with 100% coverage.

- [ ] **Step 5: Commit the runner**

```bash
git add apps/ai-service/src/proposal-live-evaluation.ts apps/ai-service/src/proposal-live-evaluation.test.ts
git commit -m "feat(ai): add bounded live proposal evaluator"
```

### Task 5: Add NVIDIA NIM contextual-orchestrator conformance workflow

**Files:**

- Create: `.github/workflows/ai-proposal-live-evaluation.yml`
- Modify: `infra/tests/deployment.spec.ts` or add a focused workflow contract test
- Create: `docs/operations/ai-proposal-live-evaluation.md`

**Interfaces:**

- Consumes repository secret `NVIDIA_NIM_API_KEY`.
- Pins contextual-orchestrator commit `6841b71935e0b7cb98fb52bcb4709cc5100c8d87` unless a later reviewed commit is intentionally selected.
- Produces uploaded artifact `ai-proposal-quality-report`.

- [ ] **Step 1: Write a failing workflow contract test**

Assert workflow-dispatch-only trigger, read-only permissions, pinned actions and contextual-orchestrator commit, no schedule, PostgreSQL 16 digest pin, one-step secret exposure, credential bootstrap over stdin, split tokens, provider allowlist, two free NVIDIA agents with increasing priorities, bounded timeouts, artifact upload, and no `pull_request_target`.

- [ ] **Step 2: Implement the workflow**

Use pinned checkout/setup actions, Python 3.13, Node 22, frozen pnpm install, contextual-orchestrator `[db]` install, generated tokens masked through GitHub commands, PostgreSQL KV bootstrap, loopback server startup, readiness probe, LifeOS build, live runner, and artifact upload with `if: always()`.

- [ ] **Step 3: Add the runbook**

Document manual invocation, model inputs, current free-endpoint verification, secret lifecycle, fallback interpretation, threshold semantics, artifact schema, failure triage, model drift, and why the workflow is not a required PR check.

- [ ] **Step 4: Verify workflow syntax and tests**

```bash
pnpm exec prettier --single-quote --check .github/workflows/ai-proposal-live-evaluation.yml docs/operations/ai-proposal-live-evaluation.md
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit workflow evidence**

```bash
git add .github/workflows/ai-proposal-live-evaluation.yml infra/tests docs/operations/ai-proposal-live-evaluation.md
git commit -m "ci(ai): add NVIDIA proposal conformance workflow"
```

### Task 6: Complete commercial and research evidence

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `apps/ai-service/package.json`
- Modify: `product/capabilities.json`
- Create: `docs/research/2026-08-05-ai-proposal-quality-evaluation-standards.md`
- Modify: `apps/ai-service/src/quality-coverage.test.ts` only when shared uncovered branches remain

- [ ] **Step 1: Record current standards and papers in APA 7**

Document NIST AI 600-1, NIST AI 100-2 E2025, OWASP LLM01:2025, CyberSecEval 2, StruQ, the 2026 Structured Output Benchmark, and current NVIDIA NIM API/structured-generation documentation. Separate schema adherence, semantic correctness, attack success, false refusal, and operational reliability.

- [ ] **Step 2: Update lint, changelog, and capabilities**

Add every new source and Markdown file to formatting checks. Add Unreleased Added/Security entries and evidence to `ai.auditable-proposals` without changing maturity or claiming a release.

- [ ] **Step 3: Run full deterministic verification**

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: all commands succeed and AI service remains at exactly 100% statement, branch, function, and line coverage.

- [ ] **Step 4: Commit evidence**

```bash
git add CHANGELOG.md apps/ai-service/package.json product/capabilities.json docs/research/2026-08-05-ai-proposal-quality-evaluation-standards.md apps/ai-service/src/quality-coverage.test.ts
git commit -m "docs(ai): complete proposal evaluation evidence"
```

### Task 7: Review, CI, and merge gate

**Files:**

- Modify only files required by actionable human, CodeRabbit, AppGuardrail, Semgrep, Security Scan, CI, or Commercial Readiness feedback.

- [ ] **Step 1: Open a draft PR after the failing-test commit**

Preserve TDD evidence and continue implementation on the same branch.

- [ ] **Step 2: Inspect every exact-head workflow and review thread**

Require CI, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and every actionable human/security thread to pass or be resolved without administrative bypass.

- [ ] **Step 3: Apply minimal root-cause fixes and rerun checks**

Add regression evidence for every defect. Never weaken thresholds or exclusions solely to make a check green.

- [ ] **Step 4: Verify completion before merge**

Confirm the PR is mergeable, not draft, based on current `main`, exact-head checks all succeed, no requested changes remain, and no actionable thread remains unresolved.

- [ ] **Step 5: Squash merge with expected-head protection**

Use title:

```text
feat(ai): add proposal quality evaluation
```

Do not merge if the head SHA moves after final verification.
