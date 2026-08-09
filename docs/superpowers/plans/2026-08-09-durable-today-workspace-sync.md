# Durable Today workspace synchronization implementation plan

**Date:** 2026-08-09  
**Issue:** #121  
**Branch:** `feat/durable-today-sync`

## Goal

Deliver a reviewable end-to-end slice in which a signed-in user can explicitly migrate browser-local Today state to planning-owned PostgreSQL storage, reopen it through the authenticated workspace boundary, and reconcile stale-device edits without silent overwrite.

## Completed on the active branch

- [x] Define `life-os.today.v1` aggregate and UUIDv4/revision/idempotency invariants.
- [x] Add RED/GREEN domain contracts for create, exact revision update, replay, conflicting key reuse, priority/schedule limits, completion evidence, and tenant isolation.
- [x] Add planning-owned PostgreSQL migration and repository.
- [x] Verify restart persistence, cross-workspace isolation, concurrent same-revision contenders, exact replay, and conflicting reuse against real PostgreSQL integration tests.
- [x] Expose bounded planning `GET`/`PUT` Today HTTP routes.
- [x] Require explicit create/update preconditions and return bounded stale-write conflicts.
- [x] Reuse the authenticated web BFF boundary so browser credentials never reach planning-service and client-supplied workspace IDs are ignored.
- [x] Add explicit browser check/save/load/reconcile states with no background upload.
- [x] Add desktop/mobile browser journey for first local-to-durable migration.
- [x] Add browser journey for stale-device conflict, recheck, and explicit newer-workspace selection.
- [x] Add CI browser-acceptance job and a workflow contract test requiring it.
- [x] Add scoped design, operations, and APA 7 standards documentation.
- [x] Reconcile capability evidence with the protected buyer-gap accounting semantics merged through #131; configured capability maturity no longer implies whole-product gap exhaustion.

## Remaining before Ready

- [ ] Obtain exact-current-head CI browser acceptance rather than predecessor-head or queued evidence.
- [ ] Obtain exact-current-head planning/web tests, PostgreSQL integration, build, Compose, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, and CodeRabbit evidence.
- [ ] Resolve every actionable exact-head human/automated review finding.
- [ ] Reconcile root `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, and canonical product documentation after the active documentation-baseline writer on PR #126 is no longer moving; do not race that branch.
- [ ] Re-evaluate branch ancestry against the then-current protected `main`; refresh only when it has integration value and preserve all exact-head evidence semantics.
- [ ] Mark Ready only after implementation/documentation contracts are complete on one stable head.

## Validation checklist

The final head must prove:

1. browser-local state causes zero workspace requests until explicit action;
2. first migration uses `If-None-Match: *` plus UUIDv4 idempotency key;
3. updates use the last explicitly observed strong `ETag` in `If-Match`;
4. stale writes preserve local state and require a fresh explicit read;
5. exact replay returns the original result and conflicting key reuse fails closed;
6. one concurrent same-revision writer wins in real PostgreSQL;
7. a different workspace cannot read the aggregate;
8. action content, cookies, credentials, SQL and internal errors do not escape public problems/artifacts;
9. the Playwright browser journey is a real CI gate, not an unexecuted repository fixture;
10. all required repository security/review gates apply to the unchanged final head.
