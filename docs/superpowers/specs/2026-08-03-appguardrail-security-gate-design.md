# AppGuardrail Security Gate Design

**Date:** 2026-08-03  
**Status:** Approved for autonomous implementation  
**Issue:** #16

## 1. Purpose

LifeOS already runs CI, Semgrep, dependency, filesystem, and supply-chain checks. This slice adds AppGuardrail as a first-class, blocking pull-request control so security requirements discovered while building LifeOS become continuously detectable rather than remaining review-only knowledge.

The integration must produce two forms of durable evidence:

1. machine-readable `appguardrail.findings.v1` JSON for regression checks and later control-plane ingestion;
2. SARIF 2.1.0 for GitHub code-scanning annotations.

A known-vulnerable test fixture proves that the installed AppGuardrail revision still recognizes an expected rule. The fixture remains visible in scan output but cannot fail the deployment gate because AppGuardrail classifies files under `tests/` as test context.

## 2. Goals

- Run AppGuardrail on every pull request targeting `main`, every push to `main`, and manual dispatches.
- Fail the security gate when AppGuardrail reports a deploy-blocking `HIGH` or `CRITICAL` finding in application code.
- Pin the AppGuardrail source and every third-party GitHub Action to immutable commits.
- Upload SARIF when the token context permits code-scanning writes.
- Retain SARIF and normalized findings JSON as short-lived workflow artifacts.
- Prove detector continuity with a repository-owned smoke fixture and machine-readable contract.
- Give future security issues a consistent way to name an AppGuardrail rule and its regression fixture.

## 3. Non-goals

- No OWASP ZAP, DAST, or requests to a deployed target.
- No AppGuardrail control-plane credentials or network push.
- No automatic suppression of findings.
- No automatic remediation.
- No replacement of the existing CI, Semgrep, or Security Scan workflows.
- No production code that intentionally contains a vulnerable pattern.

## 4. Architecture

### 4.1 Workflow

A dedicated `.github/workflows/appguardrail.yml` job performs the following sequence:

1. check out LifeOS;
2. check out `ContextualWisdomLab/appguardrail` at an immutable commit into a temporary repository subdirectory;
3. verify the checked-out AppGuardrail commit exactly matches the expected SHA;
4. copy the scanner source to the runner temporary directory and remove the temporary checkout from the LifeOS worktree;
5. run AppGuardrail with external engines disabled, emitting findings JSON and SARIF;
6. verify the findings against the committed detector contract;
7. upload SARIF to GitHub code scanning when the event is trusted;
8. upload JSON and SARIF as a seven-day artifact;
9. fail the job when the scan gate or detector-contract verification fails.

The scan step uses `continue-on-error: true` only so evidence can be uploaded after a finding. A final explicit gate converts the recorded step outcomes into the workflow result. This does not weaken enforcement.

### 4.2 Supply-chain pinning

The workflow installs no floating PyPI package. It executes the AppGuardrail source checked out at a fixed Git commit. GitHub Actions are referenced by complete commit SHAs. The workflow verifies the AppGuardrail checkout before execution.

### 4.3 Detector contract

`security/appguardrail-contract.json` contains a versioned list of expected detections. Each entry specifies:

- originating LifeOS issue number;
- AppGuardrail `rule_id`;
- expected severity;
- expected context;
- exact fixture path.

The first contract entry targets `dangerous-cors` in `tests/appguardrail-fixtures/dangerous-cors.ts`. AppGuardrail should report it as `HIGH` with context `test`. The test context keeps the fixture non-blocking while proving the detector works.

### 4.4 Contract verifier

A dependency-free Node.js package at `packages/appguardrail-contract` validates:

- the findings envelope uses schema `appguardrail.findings.v1`;
- the contract uses the supported contract version;
- every expected detection appears exactly as specified;
- rule identifiers, paths, severities, and contexts are non-empty strings;
- issue identifiers are positive integers;
- duplicate contract entries are rejected.

The verifier returns a non-zero exit code with a generic diagnostic when evidence is missing or malformed. It never prints finding snippets or potential secret material.

## 5. Configuration

`.appguardrail.json` defines the repository gate explicitly:

```json
{
  "fail_on": "HIGH",
  "exclude_rules": []
}
```

An exclusion requires a normal reviewed repository change. Invalid configuration must fail loudly through AppGuardrail.

## 6. Permissions and fork safety

Top-level workflow permissions remain `contents: read`. The scan job receives only:

- `contents: read`;
- `security-events: write` for SARIF upload;
- `actions: read` for code-scanning compatibility.

SARIF upload is skipped for pull requests from forks because GitHub does not provide a trusted write token in that context. The AppGuardrail scan, detector contract, artifact upload, and blocking gate still run.

No repository or organization secrets are read by this workflow.

## 7. Data handling

Artifacts contain normalized findings and SARIF only. They must not contain production data, personal goals, credentials, raw session tokens, OAuth codes, PKCE verifiers, or provider tokens. The smoke fixture contains only a synthetic insecure CORS header.

Artifact retention is seven days. No scan is pushed to an external control plane in this slice.

## 8. Testing

### 8.1 Unit tests

Node's built-in test runner verifies the contract parser and matching behavior:

- accepted envelope and matching contract;
- missing expected detection;
- wrong severity or context;
- malformed schema;
- duplicate contract entries;
- malformed issue identifiers.

### 8.2 Repository integration

The normal monorepo test task discovers the contract package. The AppGuardrail workflow performs the end-to-end integration by scanning the checked-out repository and verifying the real JSON output against the contract.

### 8.3 Existing controls

The change must also pass:

- formatting;
- TypeScript and package lint/type checks;
- all unit and PostgreSQL integration tests;
- builds;
- Docker Compose validation;
- Semgrep;
- existing Security Scan;
- CodeRabbit or other available review feedback.

## 9. Failure behavior

- AppGuardrail checkout mismatch: fail before scanning.
- AppGuardrail execution error: upload any generated evidence, then fail.
- Deploy-blocking AppGuardrail finding: upload evidence, then fail.
- Missing detector fixture finding: fail the contract verification.
- Malformed JSON or contract: fail without echoing untrusted findings.
- SARIF absent after scan: artifact/upload steps surface the missing evidence and the final gate fails.
- SARIF upload unavailable on a fork: skip only the code-scanning upload; preserve the scan and gate result.

## 10. Future security issues

A LifeOS issue that should remain detectable by AppGuardrail must record:

1. the AppGuardrail rule ID;
2. the non-production regression fixture path;
3. expected severity and context;
4. remediation and verification criteria.

If AppGuardrail lacks the needed detector, development should add or update the rule in the AppGuardrail repository first, then pin the reviewed AppGuardrail commit in LifeOS and add the contract entry.

## 11. Acceptance criteria

- The synthetic CORS fixture is reported as `dangerous-cors`, `HIGH`, context `test`.
- A clean LifeOS scan emits both JSON and SARIF.
- App-code `HIGH` or `CRITICAL` findings fail the workflow.
- The fixture remains visible but non-blocking.
- SARIF and findings artifacts upload successfully in trusted GitHub Actions contexts.
- Third-party actions and AppGuardrail source are immutable-pinned.
- No secrets, personal data, or production credentials are introduced.
- All repository checks and actionable review findings are resolved before merge.
