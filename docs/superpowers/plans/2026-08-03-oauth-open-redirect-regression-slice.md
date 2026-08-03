# OAuth Open Redirect Regression Slice

## Goal

Complete the AppGuardrail regression contract required by issue #18 without weakening production callback behavior or scanner policy.

## Changes

1. Add a synthetic, non-production OAuth callback fixture under `tests/appguardrail-fixtures/` that redirects directly to request input.
2. Add the exact `node-open-redirect-user-input` HIGH/test finding to `security/appguardrail-contract.json` for issue #18.
3. Keep the fixture outside all application packages and production bundles.
4. Add the new artifacts to the repository formatting gate.

## Validation

- formatting, lint, type checking, tests, and build pass;
- AppGuardrail reports the fixture exactly as contracted;
- production callback code has no deploy-blocking AppGuardrail finding;
- Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and review threads complete without actionable findings.
