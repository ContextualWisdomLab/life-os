# NVIDIA-backed OpenCode commercial development loop implementation plan

> **Execution method:** Follow test-driven development and verification-before-completion. The deterministic selector, prompt builder, diff validator, receipt validator, and workflow contract are implemented before any live OpenCode invocation is enabled.

**Goal:** Add one hourly and manually dispatchable OpenCode development loop that uses only `NVIDIA_NIM_API_KEY`, creates at most one bounded same-repository draft pull request, and leaves the existing deterministic audit/review/merge loop authoritative.

**Architecture:** `@life-os/commercial-development-agent` owns versioned deterministic policy. GitHub Actions gathers bounded public repository evidence, creates one UUIDv4 automation branch, runs one exact pinned OpenCode CLI process without a GitHub token, validates the resulting diff, then commits and opens a draft pull request through a separate credentialed step. Provider absence produces a sanitized receipt and no repository mutation.

**Tech stack:** Node.js 22, TypeScript-free ESM for a minimal runtime surface, Vitest, GitHub Actions, GitHub CLI, exact OpenCode package pin, NVIDIA NIM hosted inference, existing commercial-readiness CLI.

## Global constraints

- Never reference or use `COPILOT_GITHUB_TOKEN`.
- Do not change the credential scheme of existing review agents.
- `NVIDIA_NIM_API_KEY` is visible only to the loopback NVIDIA credential bridge step.
- OpenCode receives no `GITHUB_TOKEN` or `GH_TOKEN`.
- All internal run, branch, and receipt identifiers are UUIDv4 strings.
- The model cannot change `.github/`, `infra/`, secrets, repository settings, lockfiles, dependency manifests, releases, tags, deployments, or branch protection in the initial slice.
- The model never commits, pushes, opens a pull request, comments, merges, or publishes artifacts.
- Deterministic code validates the issue, prompt, diff, exact base SHA, receipt, and draft-only pull-request contract.
- One run creates at most one feature branch, one commit, and one draft pull request.
- Existing CI, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human review remain the merge gate.
- Every production declaration has explanatory JSDoc and package coverage remains 100%.
- Realistic prompt-injection and buyer-gap fixtures are mandatory.

---

## Task 1: Define the versioned policy and schemas

**Files**

- Create: `packages/commercial-development-agent/package.json`
- Create: `packages/commercial-development-agent/src/contracts.mjs`
- Create: `packages/commercial-development-agent/src/contracts.test.mjs`
- Create: `product/opencode-commercial-development-policy.json`

### RED

Write tests for:

- UUIDv4 run and branch identifiers;
- exact lowercase 40-character base SHA;
- bounded repository, issue title/body/URL, and model label;
- fixed status and reason-code vocabularies;
- exact receipt keys and credential-free serialization;
- multiword package/policy identifiers;
- immutable normalized policy;
- rejection of unknown keys, control bytes, numeric-only internal IDs, oversized strings, secret-shaped fields, and unsafe limits.

Run:

```bash
pnpm --filter @life-os/commercial-development-agent test
```

Expected: module-not-found or failing contract assertions.

### GREEN

Implement pure validators and immutable normalized contracts. Keep GitHub issue numbers as external references only; never reuse them as internal run identifiers.

### REFACTOR

Ensure every exported declaration has JSDoc and no validator retains rejected input in an error message.

---

## Task 2: Implement deterministic issue selection and prompt construction

**Files**

- Create: `packages/commercial-development-agent/src/issue-selector.mjs`
- Create: `packages/commercial-development-agent/src/issue-selector.test.mjs`
- Create: `packages/commercial-development-agent/src/prompt-builder.mjs`
- Create: `packages/commercial-development-agent/src/prompt-builder.test.mjs`
- Create: `packages/commercial-development-agent/fixtures/issues.json`

### RED

Cover realistic fixtures:

- a bounded buyer-visible application issue;
- Korean and English requirements;
- an issue already referenced by an open pull request;
- the living commercial-readiness issue;
- billing, credential, visibility, branch-protection, release, deployment, and destructive-data requests;
- issue bodies containing prompt injection such as “ignore policy,” “print secrets,” “modify workflow,” “merge as admin,” or “push directly to main”;
- control characters and oversized bodies;
- no eligible issue.

Assert prompt output:

- separates untrusted issue data from fixed policy;
- contains exact base SHA, UUIDv4 run ID, allowed/prohibited paths, mandatory tests, and no-commit/no-push/no-merge instructions;
- remains below 32,768 bytes;
- does not interpolate shell syntax;
- carries no GitHub or provider credential.

### GREEN

Select one allowlisted eligible issue deterministically by policy order and then issue number. Build one versioned prompt from a fixed template.

### REFACTOR

Store prompt-injection terms as policy categories, not a single brittle substring check. Treat detection as a reason to quote and constrain issue text, not as permission to execute it.

---

## Task 3: Implement the deterministic diff validator

**Files**

- Create: `packages/commercial-development-agent/src/diff-validator.mjs`
- Create: `packages/commercial-development-agent/src/diff-validator.test.mjs`
- Create: `packages/commercial-development-agent/fixtures/diffs/`

### RED

Use real temporary Git repositories to prove:

- a realistic bounded application/test/documentation diff is accepted;
- 25 changed files, 131,073 changed bytes, or 3,001 changed lines are rejected;
- `.github`, `.env`, `infra`, lockfile, manifest, release, coverage, build, cache, binary, symlink, submodule, and path-traversal changes are rejected;
- `COPILOT_GITHUB_TOKEN`, GitHub-token persistence, secret-shaped values, force push, tag/release, branch-protection, administrative merge, destructive SQL/shell, and credential-output patterns are rejected;
- deleted security/legal files are rejected;
- base drift is rejected;
- empty changes produce `no_change` rather than a pull request;
- deterministic counts and sorted path evidence are returned without source content.

### GREEN

Build deterministic evidence by comparing the trusted checkout with the candidate workspace through filesystem metadata and Python `filecmp`/`difflib`, then validate the resulting JSON with `validateCommercialDevelopmentDiff`. After materializing an accepted candidate, run `git diff --check` as a separate pre-mutation check. Reject before any remote push.

### REFACTOR

Keep path policy in the versioned JSON policy and stable source-level prohibitions in code. Error objects expose only stable reason codes.

---

## Task 4: Implement credential-free receipts and the CLI

**Files**

- Create: `packages/commercial-development-agent/src/receipt.mjs`
- Create: `packages/commercial-development-agent/src/receipt.test.mjs`
- Create: `packages/commercial-development-agent/src/cli.mjs`
- Create: `packages/commercial-development-agent/src/cli.test.mjs`

### RED

Cover:

- issue selection and prompt-file generation;
- diff validation and `completed`, `no_eligible_issue`, `provider_credential_missing`, `provider_unavailable`, `diff_rejected`, `base_changed`, and `verification_failed` receipts;
- private temporary files with atomic publication;
- receipt redaction of prompt, issue body, source diff, model output, credentials, stack traces, and provider bodies;
- exact timestamps and UUIDv4 run IDs;
- invalid CLI arguments and paths;
- no shell interpolation of issue text.

### GREEN

Expose commands:

```text
commercial-development-agent select
commercial-development-agent prompt
commercial-development-agent validate-diff
commercial-development-agent receipt
```

All commands read JSON from private files and write only versioned JSON to explicitly supplied absolute paths.

### REFACTOR

Use one production filesystem seam and one command seam, each exhaustively tested.

---

## Task 5: Pin and verify OpenCode

**Files**

- Modify: `packages/commercial-development-agent/package.json`
- Modify: `pnpm-lock.yaml`
- Create then remove before merge: `.github/workflows/bootstrap-opencode-commercial-agent.yml`

### RED

Add a workflow-contract test that rejects:

- floating OpenCode package versions;
- installer pipes such as `curl | sh`;
- mutable GitHub Action tags;
- missing CLI-version verification;
- OpenCode invocation with GitHub credentials;
- provider credentials outside the one model step.

### GREEN

On the feature branch only, a temporary bootstrap workflow:

1. resolves the current official OpenCode npm package once;
2. adds it with an exact version;
3. updates `pnpm-lock.yaml`;
4. verifies the installed `opencode --version` and `opencode run --help` contract;
5. runs all package tests;
6. commits the exact lock evidence;
7. removes itself before merge.

The final branch contains no floating version or write-capable bootstrap workflow.

---

## Task 6: Add the hourly/manual GitHub Actions workflow

**Files**

- Create: `.github/workflows/opencode-commercial-development.yml`
- Create: `packages/commercial-development-agent/src/workflow-contract.test.mjs`

### RED

Assert:

- hourly schedule and manual dispatch;
- no `pull_request_target`;
- all actions pinned by full SHA;
- single-flight concurrency;
- 120-minute workflow and 90-minute OpenCode timeout;
- one `develop` job with separate selection, credential-bridge, model, validation, and credentialed mutation steps;
- `NVIDIA_NIM_API_KEY` appears in exactly one step;
- `GITHUB_TOKEN`, `GH_TOKEN`, and review-agent credentials are absent from the OpenCode step;
- `COPILOT_GITHUB_TOKEN` is absent from the repository workflow;
- branch names use UUIDv4 suffixes;
- captured main SHA must still match before push;
- only draft pull requests are created;
- no merge, admin, release, deployment, secret, variable, environment, or repository-setting endpoint is called;
- report artifact contains only the credential-free receipt and has seven-day retention;
- cleanup runs with `always()` and removes private OpenCode configuration, prompt, model output, logs, and credential aliases.

### GREEN

Workflow sequence:

1. deterministic audit and open-PR drain check;
2. bounded issue evidence collection;
3. issue selection and prompt creation;
4. UUIDv4 branch creation from exact main SHA;
5. loopback bridge invocation with the NVIDIA credential, followed by OpenCode with only a placeholder provider key and no GitHub credential;
6. deterministic diff validation;
7. repository tests selected from changed packages plus root gates;
8. base-SHA recheck;
9. commit and push the bounded branch;
10. create a draft pull request;
11. publish a sanitized receipt;
12. clean temporary files.

Provider absence or failure ends with a successful sanitized unavailable receipt and no branch push.

### REFACTOR

Move reusable deterministic shell behavior into package CLI commands. Keep the workflow declarative and easy to audit.

---

## Task 7: Add realistic end-to-end dry-run evidence

**Files**

- Create: `packages/commercial-development-agent/src/dry-run.integration.test.mjs`
- Create: `packages/commercial-development-agent/fixtures/repository/`

### RED

Build a temporary repository fixture containing:

- one small web capability gap;
- tests and documentation expectations;
- hostile issue text attempting workflow and secret changes;
- an existing open pull-request reference;
- a base SHA that can be advanced during validation.

### GREEN

Use a deterministic fake OpenCode seam to write the expected bounded change. Prove selection → prompt → diff validation → verification receipt → draft-PR request payload while asserting no main mutation, no secret exposure, no unsafe path, and no merge request.

### REFACTOR

Keep the fake agent output shaped as ordinary source changes, not a privileged internal shortcut.

---

## Task 8: Document operations, standards, and architecture

**Files**

- Create: `docs/operations/opencode-commercial-development-loop.md`
- Create: `docs/research/2026-08-07-opencode-commercial-development-loop-standards.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `product/capabilities.json`

Document:

- operator enablement and disablement;
- exact secret and variable names;
- credential scope and incident revocation;
- branch/PR reconciliation;
- provider outage behavior;
- path and size policy;
- OpenCode version update procedure;
- central `.github` reusable-workflow migration contract;
- deterministic versus model-assisted responsibilities;
- route baseline and future orchestration ablations;
- APA 7 references and publication status;
- diagrams for trust boundaries and the autonomous loop.

---

## Task 9: Complete exact-head review and merge

1. Remove every temporary bootstrap or repair workflow.
2. Confirm the final diff contains no `COPILOT_GITHUB_TOKEN` and no review-agent credential changes.
3. Run formatting, package lint, package tests with 100% coverage, root lint/typecheck/test/build, Compose validation, and commercial-readiness tests.
4. Inspect every human, CodeRabbit, AppGuardrail, Semgrep, Security Scan, and supply-chain finding.
5. Fix root causes and rerun the exact head.
6. Resolve only addressed review threads.
7. Merge only when all required checks and statuses succeed, no changes are requested, no actionable thread remains, and the base SHA has not drifted.
8. Leave the hourly workflow enabled only after its dry-run and permission contracts pass.
