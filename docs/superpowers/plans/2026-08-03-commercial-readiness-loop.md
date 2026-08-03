# Commercial Readiness Control Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an hourly, evidence-based product-gap audit and a fail-closed pull-request drain that never bypasses review or security gates.

**Architecture:** A dependency-free Node 22 package validates a versioned capability manifest, inspects bounded repository evidence, collects a minimized GitHub snapshot, renders one living readiness issue, and rechecks merge eligibility immediately before a SHA-bound squash merge. GitHub Actions separates read, issue-write, and merge-write permissions.

**Tech Stack:** Node.js 22 built-ins, `node:test`, GitHub REST/GraphQL APIs, GitHub Actions, JSON contracts.

## Global Constraints

- All LifeOS internal identifiers remain opaque UUIDv4 strings.
- GitHub issue and pull-request numbers are external references only.
- AppGuardrail, CI, Semgrep, Security Scan, Commercial Readiness, and CodeRabbit remain mandatory merge evidence.
- No admin merge, force push, force merge, security exclusion, raw review body, credential, or personal data.
- All third-party Actions are pinned to full commit SHAs.
- Artifacts are retained for at most seven days.

---

### Task 1: Strict capability and policy schemas

**Files:**

- Create: `packages/commercial-readiness/src/schema.mjs`
- Test: `packages/commercial-readiness/src/schema.test.mjs`
- Create: `product/capabilities.json`
- Create: `product/commercial-readiness-policy.json`

**Interfaces:**

- Produces: `validateCapabilityManifest(value)`, `validateCommercialReadinessPolicy(value)`, `validateGitHubSnapshot(value)`, `MATURITY_LEVELS`, and `MATURITY_RANK`.

- [x] Write failing tests for valid manifests, malformed IDs, duplicate IDs, unknown dependencies, cycles, evidence-kind confusion, traversal, unsafe probes, weakened policy gates, raw review bodies, and malformed snapshots.
- [x] Run `node --test packages/commercial-readiness/src/schema.test.mjs` and verify missing exports fail.
- [x] Implement strict normalization, path rules, cycle detection, required security gates, seven-day retention, and snapshot minimization.
- [x] Add the initial 21-capability buyer outcome manifest and strict merge policy.
- [x] Run the schema tests and verify all pass.

### Task 2: Evidence audit and deterministic gap ledger

**Files:**

- Create: `packages/commercial-readiness/src/audit.mjs`
- Test: `packages/commercial-readiness/src/audit.test.mjs`

**Interfaces:**

- Consumes: validated capability manifest.
- Produces: `evaluateCapabilities(manifest, { rootDir, generatedAt, commitSha })` and `life-os.commercial-readiness-report.v1`.

- [x] Write failing tests for completed-gap removal, documentation-only evidence, deterministic prioritization, and oversized evidence.
- [x] Run the tests and verify the missing module failure.
- [x] Implement bounded regular-file probes, cumulative maturity, dependency fan-out, deterministic scoring, weighted maturity, and sorted missing evidence.
- [x] Run the audit tests and verify all pass.

### Task 3: Fail-closed PR gate

**Files:**

- Create: `packages/commercial-readiness/src/pr-gate.mjs`
- Test: `packages/commercial-readiness/src/pr-gate.test.mjs`

**Interfaces:**

- Produces: `evaluatePullRequestForMerge(pr, policy) -> { eligible, blockers }`.

- [x] Write the eligible fixture and one failing fixture for every unsafe state.
- [x] Verify tests fail before implementation.
- [x] Implement latest-review folding, same-repository checks, base freshness, exact-head workflow/status matching, and strict success conclusions.
- [x] Verify draft, fork, untrusted author, conflict, stale base, requested changes, unresolved thread, missing/pending/failed/cancelled/skipped checks, missing status, and stale head all block.

### Task 4: Safe rendering and living issue synchronization

**Files:**

- Create: `packages/commercial-readiness/src/render.mjs`
- Create: `packages/commercial-readiness/src/github-client.mjs`
- Test: `packages/commercial-readiness/src/render.test.mjs`
- Test: `packages/commercial-readiness/src/github-client.test.mjs`

**Interfaces:**

- Produces: `sanitizeUntrustedText`, `renderCommercialReadinessIssue`, `GitHubApiClient`, `collectRepositorySnapshot`, `syncReadinessIssue`, `mergeEligiblePullRequests`, and `mergePullRequestThroughApi`.

- [x] Write tests for token redaction, Markdown/HTML escaping, deterministic rendering, fixed API origin, no redirects, response limits, duplicate issue closure, dry-run, head recheck, and head movement.
- [x] Verify tests fail before implementation.
- [x] Implement bounded API reads, minimal snapshots, GraphQL review-thread counts, workflow/status collection, canonical issue updates, and SHA-bound squash merge.
- [x] Run tests and verify all pass.

### Task 5: CLI and defense-in-depth execution boundaries

**Files:**

- Create: `packages/commercial-readiness/src/cli.mjs`
- Test: `packages/commercial-readiness/src/cli.test.mjs`
- Create: `packages/commercial-readiness/package.json`

**Interfaces:**

- Commands: `snapshot`, `audit`, `publish`, and `drain`.

- [x] Write tests for bounded argument parsing, unknown/duplicate options, symlink rejection, and oversized JSON.
- [x] Verify tests fail before the CLI exists.
- [x] Implement atomic output, schema validation, minimized logging, dry-run default, explicit `--merge`, and event/ref checks for merge mode.
- [x] Run package lint, syntax checks, and all tests.

### Task 6: Hourly workflow and supply-chain contract

**Files:**

- Create: `.github/workflows/commercial-readiness.yml`
- Test: `packages/commercial-readiness/src/workflow-contract.test.mjs`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**

- Workflow name: `Commercial Readiness`.
- Schedule: `23 * * * *`.

- [x] Write failing workflow-contract tests for schedule, PR write isolation, full-SHA action pins, seven-day evidence, required gates, and absence of force/admin merge.
- [x] Implement read-only audit, issue-write publish, and schedule/manual merge jobs.
- [x] Pin checkout, setup-node, upload-artifact, and download-artifact by full SHA.
- [x] Validate YAML syntax and workflow-contract tests.
- [ ] Run repository CI, AppGuardrail, Semgrep, Security Scan, and CodeRabbit on the pull request; fix all actionable findings.
- [ ] Squash-merge only after every required check succeeds and no actionable review thread remains.
