# Contextual Orchestrator Proposal Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, schema-constrained `contextual-orchestrator` proposal-model adapter while retaining LifeOS's independent rule-based mode and immutable audit boundary.

**Architecture:** Keep `ProposalService` unchanged as the authoritative model-output validator. Add one Fetch-based external adapter and one explicit runtime selector; all provider routing and fallback remain inside `contextual-orchestrator`, and selected external mode fails closed rather than silently switching LifeOS models.

**Tech Stack:** TypeScript 5.9, Node.js 24 Fetch and AbortSignal APIs, NestJS 11, Vitest 3 with V8 100% coverage, OpenAI-compatible chat completions, JSON Schema Draft 2020-12.

## Global Constraints

- External proposal generation remains inert and cannot receive a write-capable dependency or tool definition.
- All objective and context text is untrusted model data.
- External mode requires one HTTPS orchestrator origin and one bounded server-only bearer token.
- Request timeout is 100-30000 milliseconds and defaults to 10000 milliseconds.
- Response bytes are capped at 65536 before complete buffering.
- No LifeOS-side silent fallback occurs after `contextual-orchestrator` mode is selected.
- Every production function, class, interface, and error constructor has explanatory JSDoc.
- AI-service statement, branch, function, and line coverage remains exactly 100%.
- Errors and logs never echo credentials or untrusted upstream response bodies.
- Database object naming is unchanged by this slice.

---

### Task 1: Lock the external adapter contract with failing tests

**Files:**
- Create: `apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts`
- Test: `apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts`

**Interfaces:**
- Consumes: `ProposalRequest` and `ProposalModelDraft` from `./proposal-service`.
- Produces expected public names for Task 2: `ContextualOrchestratorProposalModel`, `ProposalModelTransportError`, `createContextualOrchestratorConfiguration`, and `ContextualOrchestratorFetch`.

- [ ] **Step 1: Write the failing request-contract test**

Create a deterministic Fetch seam that records one `RequestInfo | URL` and `RequestInit`, returns a streamed OpenAI-compatible JSON response, and assert the adapter sends exactly `/v1/chat/completions`, bearer authentication, `application/json`, model `contextual-orchestrator`, no tools, a fixed system instruction, serialized untrusted evidence, and `response_format.type = json_schema` with `additionalProperties: false` at every object boundary.

- [ ] **Step 2: Write failing bounded-failure tests**

Cover HTTP 429, network rejection, missing body, oversized body, malformed JSON, missing choices, non-string content, empty content, and malformed structured content. Assert each rejects with `ProposalModelTransportError` and that `String(error)` does not contain the configured token or upstream response text.

- [ ] **Step 3: Write failing configuration tests**

Cover valid HTTPS origin and timeout settings plus rejection of HTTP, credentials, path, query, fragment, loopback hostnames, missing token, oversized token, invalid mode values, and timeout bounds.

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm --filter @life-os/ai-service exec vitest run src/contextual-orchestrator-proposal-model.test.ts --no-file-parallelism
```

Expected: FAIL because `./contextual-orchestrator-proposal-model` does not exist.

- [ ] **Step 5: Commit the failing contract**

```bash
git add apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts
git commit -m "test(ai): define contextual orchestrator transport contract"
```

### Task 2: Implement the bounded external proposal model

**Files:**
- Create: `apps/ai-service/src/contextual-orchestrator-proposal-model.ts`
- Test: `apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts`

**Interfaces:**
- Consumes: `ProposalModel`, `ProposalModelDraft`, and `ProposalRequest` from `./proposal-service`.
- Produces:
  - `interface ContextualOrchestratorConfiguration { origin: URL; token: string; timeoutMilliseconds: number }`
  - `type ContextualOrchestratorFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>`
  - `class ProposalModelTransportError extends Error`
  - `createContextualOrchestratorConfiguration(environment: Readonly<Record<string, string | undefined>>): ContextualOrchestratorConfiguration`
  - `class ContextualOrchestratorProposalModel implements ProposalModel`

- [ ] **Step 1: Implement sanitized configuration parsing**

Accept only `https:` origins whose pathname is `/`, with no username, password, search, or hash; reject `localhost`, `.localhost`, IPv4 loopback, and IPv6 loopback. Require a trimmed token of 32-4096 UTF-8 bytes without CR, LF, or NUL. Parse timeout as a safe integer in the global bounds.

- [ ] **Step 2: Implement the exact request schema and prompt**

Use a frozen request payload. Put model-owned instruction in the system message and `JSON.stringify(input)` in a user message explicitly delimited as untrusted data. Include no provider tools. Use a strict JSON Schema for the three proposal fields and operation variants.

- [ ] **Step 3: Implement bounded transport and parsing**

Call Fetch with `AbortSignal.timeout(timeoutMilliseconds)`. Read the response `ReadableStream` incrementally, cancel when bytes exceed 65536, decode with fatal UTF-8 handling, parse the OpenAI envelope, extract non-empty string content, parse it as JSON, and return it as an untrusted `ProposalModelDraft` without duplicating `ProposalService` validation.

- [ ] **Step 4: Collapse all external failures into one sanitized error**

Let `ProposalModelTransportError` escape unchanged; convert every other configuration, Fetch, stream, decode, status, envelope, and JSON failure into a new credential-free instance. Do not interpolate URL, token, body, status text, or nested error messages.

- [ ] **Step 5: Verify GREEN for the adapter**

Run:

```bash
pnpm --filter @life-os/ai-service exec vitest run src/contextual-orchestrator-proposal-model.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit the adapter**

```bash
git add apps/ai-service/src/contextual-orchestrator-proposal-model.ts apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts
git commit -m "feat(ai): add bounded contextual orchestrator transport"
```

### Task 3: Select the model explicitly in the production runtime

**Files:**
- Modify: `apps/ai-service/src/ai-runtime.ts`
- Modify: `apps/ai-service/src/ai-runtime.test.ts`

**Interfaces:**
- Consumes: `createContextualOrchestratorConfiguration` and `ContextualOrchestratorProposalModel` from Task 2.
- Produces: `createProposalModelRuntime(environment, fetcher?)` returning `{ model: ProposalModel; modelId: 'rule-based-v1' | 'contextual-orchestrator-v1' }`, used by `createAiRuntime`.

- [ ] **Step 1: Write failing runtime-selection tests**

Assert absent or `rule-based` mode returns `RuleBasedProposalModel` and `rule-based-v1`; external mode returns `ContextualOrchestratorProposalModel` and `contextual-orchestrator-v1`; unsupported modes and incomplete external configuration fail before pool construction; injected Fetch reaches the adapter.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @life-os/ai-service exec vitest run src/ai-runtime.test.ts --no-file-parallelism
```

Expected: FAIL because the selector and Fetch seam do not exist.

- [ ] **Step 3: Implement the minimal selector and runtime wiring**

Default to rule-based mode. Pass the selected model to `ProposalService` and the selected model identifier to `ProposalAuditApplication`. Parse external configuration before creating the PostgreSQL pool so invalid provider configuration cannot allocate database resources.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @life-os/ai-service exec vitest run src/ai-runtime.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit runtime wiring**

```bash
git add apps/ai-service/src/ai-runtime.ts apps/ai-service/src/ai-runtime.test.ts
git commit -m "feat(ai): select contextual orchestrator explicitly"
```

### Task 4: Complete assurance, operational, and commercial evidence

**Files:**
- Modify: `.env.example`
- Modify: `CHANGELOG.md`
- Modify: `apps/ai-service/package.json`
- Modify: `apps/ai-service/migrations/README.md`
- Create: `docs/operations/contextual-orchestrator-proposal-transport.md`
- Create: `docs/research/2026-08-05-contextual-orchestrator-proposal-transport-standards.md`
- Modify: `product/capabilities.json`
- Test: `apps/ai-service/src/quality-coverage.test.ts` only if uncovered shared branches remain after focused tests

**Interfaces:**
- Consumes: production environment and error contracts from Tasks 2-3.
- Produces: deployable configuration, runbook, APA 7 standards record, changelog entry, lint coverage, and commercial-readiness evidence.

- [ ] **Step 1: Document environment and operations**

Add explicit local and external mode examples, independent-service deployment topology, token handling, timeout/body limits, no-silent-fallback semantics, orchestrator-owned free-model fallback, staged enable/disable procedure, rollback to rule-based mode, and incident guidance.

- [ ] **Step 2: Record current standards in APA 7 format**

Document NIST AI 600-1, RFC 9110, JSON Schema Draft 2020-12 Core and Validation, and OWASP LLM01:2025. Distinguish schema-constrained output from authoritative application validation and explain why an inert no-tools boundary reduces prompt-injection impact without claiming elimination.

- [ ] **Step 3: Update release and capability evidence**

Add an Unreleased `Added` entry and security entry. Add implementation, test, operations, and research evidence to `ai.auditable-proposals` without changing target maturity or claiming a release. Add the new Markdown files to the AI-service Prettier lint command.

- [ ] **Step 4: Run full deterministic verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @life-os/ai-service lint
pnpm --filter @life-os/ai-service typecheck
pnpm --filter @life-os/ai-service test
pnpm --filter @life-os/ai-service build
pnpm test
```

Expected: all commands succeed and AI-service coverage reports 100% for statements, branches, functions, and lines.

- [ ] **Step 5: Commit evidence**

```bash
git add .env.example CHANGELOG.md apps/ai-service/package.json apps/ai-service/migrations/README.md docs/operations/contextual-orchestrator-proposal-transport.md docs/research/2026-08-05-contextual-orchestrator-proposal-transport-standards.md product/capabilities.json apps/ai-service/src/quality-coverage.test.ts
git commit -m "docs(ai): complete orchestrator transport evidence"
```

### Task 5: Review, CI, and merge gate

**Files:**
- Modify only files required by actionable human, CodeRabbit, AppGuardrail, Semgrep, Security Scan, CI, or Commercial Readiness feedback.

**Interfaces:**
- Consumes: exact PR head SHA and all review/check outputs.
- Produces: one squash-merged PR with no unresolved actionable findings.

- [ ] **Step 1: Open a draft PR after the failing-test commit, then continue implementation on the same branch**

The draft preserves TDD evidence. Mark ready only after deterministic local-equivalent verification is represented by CI.

- [ ] **Step 2: Inspect every exact-head workflow and review thread**

Require CI, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and every actionable human/security thread to pass or be resolved without administrative bypass.

- [ ] **Step 3: Apply minimal fixes and rerun checks**

For each failure, identify the root cause, write or strengthen a failing regression test, implement the minimum fix, and rerun the exact affected and full gates.

- [ ] **Step 4: Verify completion before merge**

Confirm the PR is mergeable, not draft, based on current `main`, exact head checks all succeed, no requested changes remain, and no unresolved actionable thread remains.

- [ ] **Step 5: Squash merge with expected-head protection**

Use title:

```text
feat(ai): add contextual orchestrator proposal transport
```

Do not merge if the head SHA moves after the final verification.
