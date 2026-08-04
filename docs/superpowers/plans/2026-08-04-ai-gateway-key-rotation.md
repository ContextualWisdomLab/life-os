# AI gateway key rotation implementation plan

Issue: #112

## Slice sequence

1. Add a bounded AI-service keyring parser with one active key, one optional previous key, immutable snapshots, sanitized failures, exact identifier selection, docstrings, and complete coverage.
2. Advance the shared canonical context to version 2 and include `x-life-os-context-key-id` in the HMAC input.
3. Update every AI controller to receive the key identifier and map request selection failures to `401` while mapping local configuration failures to `503`.
4. Update the web BFF to parse one active signing pair, sign only with that pair, emit the identifier header, and keep all material server-only.
5. Replace single-secret environment variables in examples, deployment references, and tests.
6. Add overlap tests proving old in-flight requests remain valid after the signer switches and become invalid after retirement.
7. Add malformed, missing, partial, duplicate, conflicting, unknown, and noncanonical identifier regressions.
8. Add no-secret logging and problem-response assertions covering both configuration and verification failures.
9. Document standards, rollout, rollback, emergency revocation, inventory metadata, and retirement evidence with APA 7 references.
10. Update capability evidence, formatting contracts, changelog, and release metadata when the complete slice is releasable.
11. Run full formatting, lint, type checking, 100% AI-service coverage, PostgreSQL integration, build, Compose, AppGuardrail, Semgrep, security, commercial readiness, and exact-head review gates.
12. Resolve all actionable human and automated review findings before merge.
