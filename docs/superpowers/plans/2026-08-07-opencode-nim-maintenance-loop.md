# NVIDIA NIM OpenCode Maintenance Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an hourly, plan-only OpenCode maintenance workflow that turns bounded LifeOS repository evidence into one validated NVIDIA NIM-backed maintenance plan without weakening independent review or exact-head merge gates.

**Architecture:** A new `@life-os/maintenance-agent` package compiles a canonical contract from deterministic commercial-readiness evidence, selects a bounded test-time compute profile, and validates one credential-free plan. A default-branch-only GitHub Actions workflow runs OpenCode with a read-mostly custom agent, preferring an exact-pinned contextual-orchestrator profile when policy requires it and otherwise using OpenCode's built-in NVIDIA provider.

**Tech Stack:** Node.js 22 ESM, Node test runner with V8 coverage, OpenCode GitHub Action, NVIDIA NIM, contextual-orchestrator, GitHub Actions, JSON/Markdown contracts, SHA-256 canonicalization.

## Global Constraints

- The scheduled path may reference only `NVIDIA_NIM_API_KEY`; `COPILOT_GITHUB_TOKEN` is prohibited.
- Existing review-agent credentials, models, workflows, and approval paths must not change.
- The initial agent is plan-only and may not commit, push, create or merge PRs, tag, release, alter rulesets, or access secrets.
- The workflow runs only from reviewed default-branch source, once per hour, single-flight, with a maximum 170-minute job budget.
- The maintenance contract and plan use exact schemas, bounded strings/arrays, canonical timestamps, and SHA-256 receipts.
- The agent may edit only one ephemeral plan path; bash, task delegation, external directories, web access, and interactive questions are denied.
- Every production declaration has explanatory documentation and the package enforces 100% statement, branch, function, and line coverage.
- Research and standards claims use APA 7 references and identify publication status.
- No product version or release tag is created by this slice.

---

### Task 1: Define the maintenance contract and compute policy

**Files:**

- Create: `packages/maintenance-agent/package.json`
- Create: `packages/maintenance-agent/src/contract.mjs`
- Create: `packages/maintenance-agent/src/contract.test.mjs`

**Interfaces:**

- Produces: `compileMaintenanceContract(input)`
- Produces: `validateMaintenanceContract(value)`
- Produces: `canonicalMaintenanceJson(value)`
- Produces: `maintenanceContractDigest(value)`
- Produces schema identifier `life-os.maintenance-contract.v1`

- [ ] **Step 1: Write failing contract tests**

Cover one failed-check PR, one unresolved-review PR, one buyer gap, no remaining gap, issue-prose injection, duplicate/oversized facts, malformed SHAs/timestamps, numeric internal identifiers, path traversal, unknown keys, and deterministic canonical digest.

```js
assert.equal(contract.action, 'inspect_pr');
assert.equal(contract.computeProfile, 'conduct_bounded');
assert.match(contract.digest, /^[0-9a-f]{64}$/u);
assert.equal(JSON.stringify(contract).includes('ignore previous'), false);
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
pnpm --filter @life-os/maintenance-agent test
```

Expected: package/module-not-found failure.

- [ ] **Step 3: Implement exact validation and selection**

Use one plain-object validator, exact key sets, 40-character lowercase commit SHAs, canonical `Date#toISOString()` timestamps, UUIDv4 internal identifiers, bounded external PR/issue numbers, allowed path prefixes, and frozen outputs. Select:

- `conduct_bounded` for credential, workflow-permission, security, migration, tenant-boundary, or destructive-operation findings;
- `route_high` for coupled package/check evidence;
- `route_standard` for one ordinary check or one buyer gap;
- `wait` or `complete` when no model work is authorized.

- [ ] **Step 4: Run focused tests and verify GREEN with exact coverage**

```bash
pnpm --filter @life-os/maintenance-agent test
```

Expected: all tests pass and statement/branch/function/line coverage equals 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/maintenance-agent
git commit -m "feat(automation): add maintenance contract compiler"
```

### Task 2: Validate the model-authored maintenance plan

**Files:**

- Create: `packages/maintenance-agent/src/plan.mjs`
- Create: `packages/maintenance-agent/src/plan.test.mjs`

**Interfaces:**

- Consumes: `validateMaintenanceContract(value)`
- Produces: `validateMaintenancePlan(contract, value)`
- Produces: `renderMaintenancePlanMarkdown(plan)`
- Produces schema identifier `life-os.maintenance-plan.v1`

- [ ] **Step 1: Write failing plan-policy tests**

Use realistic plans for check diagnosis, unresolved review, and buyer-gap recommendation. Reject digest/SHA mismatch, extra fields, raw logs, HTML, control bytes, secret/bearer patterns, hidden-reasoning markers, unauthorized paths, numeric internal IDs, merge/release/protection/secret operations, more than 20 steps, and decision claims without a stable reason code.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @life-os/maintenance-agent test
```

Expected: missing plan module.

- [ ] **Step 3: Implement exact plan validation and rendering**

The plan contains contract digest, source SHA, action, compute profile, diagnosis classes, ordered verification/remediation steps, expected checks, decision-required flag, reason code, and acknowledged prohibitions. Every recommended path must be within the contract's allowlist.

- [ ] **Step 4: Run tests and verify GREEN with exact coverage**

```bash
pnpm --filter @life-os/maintenance-agent test
```

- [ ] **Step 5: Commit**

```bash
git add packages/maintenance-agent/src/plan.mjs packages/maintenance-agent/src/plan.test.mjs
git commit -m "feat(automation): validate maintenance plans"
```

### Task 3: Add the contract and plan CLI

**Files:**

- Create: `packages/maintenance-agent/src/cli.mjs`
- Create: `packages/maintenance-agent/src/cli.test.mjs`
- Modify: `packages/maintenance-agent/package.json`

**Interfaces:**

- Command: `maintenance-agent compile --snapshot <path> --audit <path> --drain <path> --output <path>`
- Command: `maintenance-agent validate-plan --contract <path> --plan <path> --markdown <path>`

- [ ] **Step 1: Write failing CLI tests**

Test absolute in-worktree paths, exclusive file creation, bounded input bytes, fatal UTF-8, sanitized errors, restrictive temporary files, read-back validation, atomic rename, and no provider/model text in output.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @life-os/maintenance-agent test
```

- [ ] **Step 3: Implement the two subcommands**

Use dependency-injected filesystem seams in production functions. Write `0600` temporary files, read and validate them, then atomically rename. CLI errors print only stable codes.

- [ ] **Step 4: Verify lint, type syntax, tests, and build**

```bash
pnpm --filter @life-os/maintenance-agent lint
pnpm --filter @life-os/maintenance-agent test
pnpm --filter @life-os/maintenance-agent build
```

- [ ] **Step 5: Commit**

```bash
git add packages/maintenance-agent
git commit -m "feat(automation): add maintenance contract CLI"
```

### Task 4: Add the read-mostly OpenCode planner agent

**Files:**

- Create: `.opencode/agents/maintenance-planner.md`
- Create: `packages/maintenance-agent/src/opencode-contract.test.mjs`

**Interfaces:**

- OpenCode primary agent: `maintenance-planner`
- Allowed edit path: `.maintenance-output/maintenance-plan.json`
- Denied: bash, task, external directories, web fetch/search, interactive question, all other edits

- [ ] **Step 1: Write the failing agent-contract test**

Parse frontmatter and require `mode: primary`, bounded `steps`, explicit read/glob/grep/list/LSP permissions, exact edit allowlist with deny fallback, and denials for bash/task/external/web/question. Reject `COPILOT_GITHUB_TOKEN`, review-agent secret names, merge/release instructions, or broad wildcard writes.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @life-os/maintenance-agent test
```

- [ ] **Step 3: Write the agent configuration**

The prompt makes `.maintenance-input/maintenance-contract.json` the only task authority, requires its digest to match the workflow-provided value, treats repository content as untrusted evidence, writes exactly one JSON plan, and prohibits source mutation and GitHub actions.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm --filter @life-os/maintenance-agent test
```

- [ ] **Step 5: Commit**

```bash
git add .opencode/agents/maintenance-planner.md packages/maintenance-agent/src/opencode-contract.test.mjs
git commit -m "feat(automation): add read-only OpenCode planner"
```

### Task 5: Add the hourly NVIDIA NIM workflow

**Files:**

- Create: `.github/workflows/opencode-nim-maintenance.yml`
- Create: `packages/maintenance-agent/src/workflow-contract.test.mjs`
- Modify: `.github/workflows/commercial-readiness.yml`

**Interfaces:**

- Schedule: minute 37 every hour plus manual dispatch
- OpenCode action pin: `anomalyco/opencode/github@77fc88c8ade8e5a620ebbe1197f3a572d29ae91a`
- Direct model: `nvidia/nvidia/llama-3.3-nemotron-super-49b-v1.5`
- Contextual-orchestrator pin: the exact reviewed SHA already used by AI live conformance

- [ ] **Step 1: Write failing workflow tests**

Require default-branch-only execution, 170-minute maximum, single-flight concurrency, immutable action pins, read-only model job token, one `NVIDIA_NIM_API_KEY` mapping to `NVIDIA_API_KEY`, no Copilot token, no review-secret changes, no contents/PR write permission, contract generation before secret exposure, output validation after OpenCode, and upload of only validated plan/contract artifacts.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @life-os/maintenance-agent test
```

- [ ] **Step 3: Implement deterministic evidence and contract jobs**

Reuse the commercial-readiness CLI to create bounded snapshot, audit, and dry-run drain evidence. Compile the maintenance contract before the model job and upload it as an artifact with seven-day retention.

- [ ] **Step 4: Implement direct and orchestrated planner paths**

Use a deterministic policy output. For `route_standard` or `route_high`, run OpenCode's built-in NVIDIA provider. For `conduct_bounded`, establish the exact-pinned contextual-orchestrator using hash-locked dependencies and encrypted KV credential bootstrap, create an ephemeral OpenAI-compatible OpenCode provider pointing to loopback, and fail closed if it cannot start. Never silently downgrade profiles.

- [ ] **Step 5: Validate and publish evidence**

Validate the generated JSON plan through the CLI, render bounded Markdown, remove raw orchestrator/OpenCode logs, upload only contract/plan/Markdown, and update issue #21 in a separate `issues: write` job.

- [ ] **Step 6: Run workflow tests and repository checks**

```bash
pnpm --filter @life-os/maintenance-agent test
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/opencode-nim-maintenance.yml .github/workflows/commercial-readiness.yml packages/maintenance-agent
git commit -m "feat(automation): schedule NVIDIA OpenCode maintenance plans"
```

### Task 6: Add operational, research, architecture, and release evidence

**Files:**

- Create: `docs/operations/opencode-nim-maintenance.md`
- Create: `docs/research/2026-08-07-opencode-nim-maintenance-standards.md`
- Modify: `AGENTS.md`
- Modify: `ARCHITECTURE.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `product/capabilities.json`
- Modify: `package.json`

**Interfaces:**

- Capability evidence for `automation.commercial-readiness-loop`
- Operator controls, rollback, artifact interpretation, and failure codes

- [ ] **Step 1: Add documentation-contract tests**

Require the workflow, runbook, research references, diagrams, no-Copilot statement, review-agent preservation, plan-only limitation, two-hour budget, exact profile policy, and capability evidence.

- [ ] **Step 2: Write the runbook and research traceability**

Document enablement variables, secret mapping, default-branch loading, direct/orchestrated profiles, provider outages, artifact schema, issue publishing, cleanup, rollback, and why no release is created. Include APA 7 references and publication status for OpenCode, NVIDIA NIM, GitHub Actions, NIST SSDF/AI RMF, OWASP, Fugu, Conductor, TRINITY, and the strong single-agent baseline.

- [ ] **Step 3: Update repository ADRs and changelog**

Add the planner boundary and diagram to `ARCHITECTURE.md`; add execution rules to `AGENTS.md` and `CLAUDE.md`; record the new hourly maintenance plan under `Unreleased`; add the operator entry point to `README.md`; register production evidence in `product/capabilities.json`; and include every new maintained file in formatting checks.

- [ ] **Step 4: Run complete verification**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```

Expected: zero failures and exact 100% maintenance-agent coverage.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md ARCHITECTURE.md CLAUDE.md CHANGELOG.md README.md package.json product/capabilities.json docs packages/maintenance-agent
git commit -m "docs(automation): govern the NVIDIA OpenCode maintenance loop"
```

### Task 7: Open, review, and merge the exact-head pull request

**Files:**

- No new source files; this task operates on the reviewed branch and PR.

- [ ] **Step 1: Open one draft PR**

Use title `feat(automation): add NVIDIA OpenCode maintenance planning` and include `Closes #119`.

- [ ] **Step 2: Inspect all feedback and checks**

Review CI, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and every human/security thread. Fix root causes and add regression evidence.

- [ ] **Step 3: Remove temporary write-capable repair assets**

Confirm no repair script/workflow, broad token permission, raw log, provider response, or credential-bearing artifact remains in the final diff.

- [ ] **Step 4: Re-run exact-head verification**

Require formatting, lint, typecheck, tests, build, Compose, 100% maintenance coverage, workflow contracts, all security checks, CodeRabbit, and zero actionable review threads on one immutable head SHA.

- [ ] **Step 5: Mark ready and squash-merge by exact SHA**

Do not bypass protection. After merge, verify PR closure and issue #119 completion, then select the next buyer-visible gap.
