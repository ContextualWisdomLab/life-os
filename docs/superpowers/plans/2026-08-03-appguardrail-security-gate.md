# AppGuardrail Security Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an immutable-pinned, blocking AppGuardrail pull-request gate that emits SARIF and normalized findings evidence and verifies a known detector through a non-production fixture.

**Architecture:** A dedicated GitHub Actions workflow checks out AppGuardrail at a fixed commit, scans LifeOS with external engines disabled, verifies the emitted `appguardrail.findings.v1` envelope against a repository-owned contract, uploads evidence, and explicitly enforces the recorded scan outcome. A dependency-free Node.js workspace package validates detector contracts and is covered by the monorepo test pipeline.

**Tech Stack:** GitHub Actions, AppGuardrail 0.1.1 source pinned at commit `4e4f6c34e4e9640ba769020e9ab4a6ebee07bab1`, Node.js 22 built-in test runner, pnpm/Turborepo, JSON, SARIF 2.1.0.

## Global Constraints

- Fail the AppGuardrail gate on `HIGH` and `CRITICAL` application-code findings.
- Keep findings in `doc`, `test`, `example`, and `scanner-fixture` contexts visible but non-blocking.
- Do not invoke ZAP, DAST, or any deployed target.
- Do not read or emit repository secrets.
- Pin AppGuardrail source and all third-party actions to complete immutable commit SHAs.
- Store no personal data, production credentials, OAuth codes, PKCE verifiers, provider tokens, or raw session tokens.
- Preserve opaque UUIDv4 internal identifier policy.
- Upload artifacts for seven days only.

---

## File map

- `packages/appguardrail-contract/package.json`: workspace scripts for syntax checking and Node tests.
- `packages/appguardrail-contract/src/verify-contract.mjs`: schema and detector-contract verifier plus CLI entry point.
- `packages/appguardrail-contract/src/verify-contract.test.mjs`: behavior tests for accepted and rejected evidence.
- `security/appguardrail-contract.json`: versioned expected-detection contract.
- `tests/appguardrail-fixtures/dangerous-cors.ts`: synthetic `dangerous-cors` fixture classified as test context.
- `.appguardrail.json`: explicit deploy-gate threshold and reviewed exclusions.
- `.github/workflows/appguardrail.yml`: pinned AppGuardrail scan, evidence upload, and blocking gate.
- `package.json`: include new maintained text files in the formatting check.
- `docs/security/appguardrail-regressions.md`: contributor contract for future detectable security issues.

### Task 1: Detector contract verifier

**Files:**
- Create: `packages/appguardrail-contract/package.json`
- Create: `packages/appguardrail-contract/src/verify-contract.test.mjs`
- Create: `packages/appguardrail-contract/src/verify-contract.mjs`

**Interfaces:**
- Consumes: a findings JSON envelope and a detector-contract JSON object.
- Produces: `verifyAppGuardrailContract(findingsEnvelope, contract): void`; throws `Error` with generic diagnostics on invalid evidence.
- CLI: `node packages/appguardrail-contract/src/verify-contract.mjs <findings-json> <contract-json>`.

- [ ] **Step 1: Create the workspace package manifest**

```json
{
  "name": "@life-os/appguardrail-contract",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node --check src/verify-contract.mjs",
    "lint": "node --check src/verify-contract.mjs && node --check src/verify-contract.test.mjs",
    "test": "node --test src/verify-contract.test.mjs",
    "typecheck": "node --check src/verify-contract.mjs && node --check src/verify-contract.test.mjs"
  }
}
```

- [ ] **Step 2: Write failing tests for valid evidence and every validation boundary**

The test imports `verifyAppGuardrailContract` and covers:

```javascript
const validEnvelope = {
  schema: 'appguardrail.findings.v1',
  findings: [
    {
      rule_id: 'dangerous-cors',
      severity: 'HIGH',
      file: 'tests/appguardrail-fixtures/dangerous-cors.ts',
      context: 'test'
    }
  ]
};

const validContract = {
  schema: 'life-os.appguardrail-contract.v1',
  expected_findings: [
    {
      issue: 16,
      rule_id: 'dangerous-cors',
      severity: 'HIGH',
      context: 'test',
      file: 'tests/appguardrail-fixtures/dangerous-cors.ts'
    }
  ]
};
```

Assertions must verify:

- valid input does not throw;
- unsupported envelope schema throws `Invalid AppGuardrail findings envelope`;
- unsupported contract schema throws `Invalid AppGuardrail detector contract`;
- missing expected finding throws `Expected AppGuardrail detection is missing`;
- wrong severity or context throws the same missing-detection error;
- duplicate expected entries throw `Duplicate AppGuardrail detector contract entry`;
- zero, negative, non-integer, or string issue identifiers throw `Invalid AppGuardrail detector contract`;
- non-array findings and expected-findings members fail closed.

- [ ] **Step 3: Run the package test and verify RED**

Run:

```bash
pnpm --filter @life-os/appguardrail-contract test
```

Expected: failure because `src/verify-contract.mjs` does not exist.

- [ ] **Step 4: Implement the minimal verifier**

Implementation rules:

- require plain objects, exact supported schemas, and arrays;
- require `rule_id`, `severity`, `context`, and `file` to be trimmed non-empty strings;
- require `issue` to be a positive safe integer;
- normalize no values silently other than trimming for comparison;
- identify duplicate contract entries by the tuple `issue|rule_id|severity|context|file`;
- find exact matches in the emitted findings;
- never include a finding object or snippet in thrown errors;
- execute the CLI only when `import.meta.url === pathToFileURL(process.argv[1]).href`;
- parse both files as UTF-8 JSON and set `process.exitCode = 1` after printing only the error message to stderr.

- [ ] **Step 5: Run the package and monorepo tests and verify GREEN**

Run:

```bash
pnpm --filter @life-os/appguardrail-contract test
pnpm test
pnpm lint
pnpm typecheck
```

Expected: all commands pass.

- [ ] **Step 6: Commit the verifier slice**

```bash
git add packages/appguardrail-contract
git commit -m "test: define AppGuardrail detector contract"
```

### Task 2: Repository detector evidence

**Files:**
- Create: `.appguardrail.json`
- Create: `security/appguardrail-contract.json`
- Create: `tests/appguardrail-fixtures/dangerous-cors.ts`
- Create: `docs/security/appguardrail-regressions.md`

**Interfaces:**
- Consumes: AppGuardrail rule `dangerous-cors`.
- Produces: one non-blocking expected finding in test context and contributor instructions for extending the contract.

- [ ] **Step 1: Add the explicit AppGuardrail gate configuration**

```json
{
  "fail_on": "HIGH",
  "exclude_rules": []
}
```

- [ ] **Step 2: Add the detector contract**

```json
{
  "schema": "life-os.appguardrail-contract.v1",
  "expected_findings": [
    {
      "issue": 16,
      "rule_id": "dangerous-cors",
      "severity": "HIGH",
      "context": "test",
      "file": "tests/appguardrail-fixtures/dangerous-cors.ts"
    }
  ]
}
```

- [ ] **Step 3: Add the synthetic test-context fixture**

```typescript
interface SyntheticResponse {
  setHeader(name: string, value: string): void;
}

export function configureUnsafeCorsFixture(response: SyntheticResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
}
```

The file must remain under `tests/appguardrail-fixtures/`; it must never be imported by an application package.

- [ ] **Step 4: Document the regression contract**

`docs/security/appguardrail-regressions.md` must require every future entry to include issue number, exact AppGuardrail rule ID, expected severity/context, non-production fixture, remediation, and verification. It must state that absent detectors are implemented and reviewed in AppGuardrail before the pinned LifeOS revision is advanced.

- [ ] **Step 5: Run AppGuardrail locally from the pinned source checkout**

```bash
python3 /path/to/pinned/appguardrail/scanner/cli/appguardrail.py \
  scan --external off \
  --findings-json appguardrail-findings.json \
  --sarif appguardrail.sarif \
  .
node packages/appguardrail-contract/src/verify-contract.mjs \
  appguardrail-findings.json \
  security/appguardrail-contract.json
```

Expected: AppGuardrail exits successfully; the verifier confirms `dangerous-cors` as `HIGH`, context `test`.

- [ ] **Step 6: Remove local scan evidence and commit**

```bash
rm -f appguardrail-findings.json appguardrail.sarif
git add .appguardrail.json security tests/appguardrail-fixtures docs/security
git commit -m "test: add AppGuardrail detector regression fixture"
```

### Task 3: Blocking GitHub Actions workflow

**Files:**
- Create: `.github/workflows/appguardrail.yml`

**Interfaces:**
- Consumes: pinned AppGuardrail commit, `.appguardrail.json`, detector contract, verifier CLI.
- Produces: required workflow result plus `appguardrail-findings.json` and `appguardrail.sarif` evidence.

- [ ] **Step 1: Create the workflow triggers, permissions, and concurrency policy**

Use:

```yaml
name: AppGuardrail

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

The scan job grants only `contents: read`, `actions: read`, and `security-events: write`, runs on `ubuntu-latest`, sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`, and times out after 15 minutes.

- [ ] **Step 2: Add immutable checkouts**

Use these exact action pins:

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
```

The second checkout targets:

```yaml
repository: ContextualWisdomLab/appguardrail
ref: 4e4f6c34e4e9640ba769020e9ab4a6ebee07bab1
path: _appguardrail
persist-credentials: false
```

- [ ] **Step 3: Verify and isolate the scanner source**

Run with `set -euo pipefail`, compare `git -C _appguardrail rev-parse HEAD` to the expected SHA, copy the checkout to `${RUNNER_TEMP}/appguardrail`, and delete `_appguardrail` from the worktree before scanning.

- [ ] **Step 4: Run the scan while preserving evidence**

```yaml
- name: Run AppGuardrail
  id: appguardrail
  continue-on-error: true
  env:
    APPGUARDRAIL_NO_EMOJI: "1"
  run: |
    set -euo pipefail
    python3 "${RUNNER_TEMP}/appguardrail/scanner/cli/appguardrail.py" \
      scan --external off \
      --findings-json appguardrail-findings.json \
      --sarif appguardrail.sarif \
      .
```

- [ ] **Step 5: Verify the detector contract independently**

Run the verifier with `if: always()` and `continue-on-error: true`, recording its step outcome.

- [ ] **Step 6: Upload SARIF safely**

Use:

```yaml
uses: github/codeql-action/upload-sarif@e4fba868fa4b1b91e1fdab776edc8cfbe6e9fb81 # v4.37.3
```

Condition the upload on the SARIF file existing and on either a non-PR event or a same-repository pull request.

- [ ] **Step 7: Upload short-lived evidence**

Use:

```yaml
uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
```

Upload both evidence files with `if: always()`, `if-no-files-found: error`, and `retention-days: 7`.

- [ ] **Step 8: Enforce the final gate**

An `if: always()` shell step must require both recorded outcomes to equal `success` and both evidence files to exist. It prints only a concise GitHub error and exits 1 otherwise.

- [ ] **Step 9: Commit the workflow**

```bash
git add .github/workflows/appguardrail.yml
git commit -m "ci: add blocking AppGuardrail security gate"
```

### Task 4: Repository integration and final verification

**Files:**
- Modify: `package.json`
- Modify: `docs/superpowers/plans/2026-08-03-appguardrail-security-gate.md`

**Interfaces:**
- Consumes: all files from Tasks 1-3.
- Produces: formatting coverage and recorded validation evidence.

- [ ] **Step 1: Extend the formatting check**

Keep the existing explicit file list and add:

- `.appguardrail.json`
- `.github/workflows/appguardrail.yml`
- `security/appguardrail-contract.json`
- `packages/appguardrail-contract/package.json`
- `packages/appguardrail-contract/src/verify-contract.mjs`
- `packages/appguardrail-contract/src/verify-contract.test.mjs`
- `tests/appguardrail-fixtures/dangerous-cors.ts`
- `docs/security/appguardrail-regressions.md`
- the design and implementation-plan documents.

- [ ] **Step 2: Run complete local verification**

```bash
pnpm install --no-frozen-lockfile
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all commands pass.

- [ ] **Step 3: Re-run the pinned AppGuardrail integration**

Run the exact scan and verifier commands from Task 2. Confirm JSON schema, expected detector entry, SARIF presence, and exit code 0. Remove generated evidence afterward.

- [ ] **Step 4: Mark the plan complete and commit**

Update every completed checkbox, then:

```bash
git add package.json docs/superpowers/plans/2026-08-03-appguardrail-security-gate.md
git commit -m "docs: record AppGuardrail gate verification"
```

- [ ] **Step 5: Open the pull request**

Open a pull request from `feat/appguardrail-security-gate` to `main` with `Closes #16` and a validation section that initially states checks are pending.

- [ ] **Step 6: Process review and GitHub checks**

For every review item: verify against the codebase, fix technically valid findings, reply in the inline thread, run affected tests, and resolve the thread. Inspect CI, AppGuardrail, Semgrep, and Security Scan logs. Re-run failed checks only after correcting root causes.

- [ ] **Step 7: Merge only after final evidence**

Require all workflows to conclude successfully, CodeRabbit or available reviews to have no actionable unresolved findings, and the PR head SHA to remain unchanged. Squash merge with an issue-referencing commit message.
