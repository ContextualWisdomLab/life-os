# LifeOS Test Strategy

**Status:** Accepted architecture  
**Baseline:** protected `main` at `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`

## 1. Principle

Tests are evidence for a specific implementation boundary and commit tree. Passing predecessor-head, synthetic-merge-only, skipped-required, cancelled, absent or stale-base evidence is not promoted to exact-current-head success.

Changes follow red -> green -> refactor where behavior changes. A regression test is meaningful only when it fails for the intended missing/broken behavior and passes after the causal fix.

## 2. Test layers

| Layer | Purpose | Representative targets |
| --- | --- | --- |
| Domain/unit | Deterministic invariants, malformed values, state transitions | planning/habit/review/identity/AI/privacy helpers |
| Repository/persistence integration | Real PostgreSQL schema, durability, tenancy, constraints, replay/concurrency | identity data-rights ledger, planning, habit, notification, AI audit, privacy |
| HTTP boundary integration | Authentication/authorization, size limits, problem/error semantics | identity/gateway/domain controllers |
| Event contract | Version/type/tenant/replay semantics | shared contracts/NATS consumers |
| Browser E2E | Buyer journeys, focus/accessibility/localization/PWA | onboarding, capture/Today and active PR #127 acceptance |
| Provider adapter | Bounded real/protocol behavior without leaking secrets | calendar adapters, model transport |
| Security regression | Injection, privilege confusion, secret leakage, SSRF/trust boundaries | AppGuardrail/Semgrep/security suites + targeted tests |
| Operations | backup/restore, deployment manifests, readiness and recovery | `infra/` scripts/workflows/runbooks |
| Documentation contract | Canonical docs existence, links, statuses and selected source claims | commercial-readiness documentation tests |

## 3. Coverage

Packages that define exact owned-production coverage gates target 100% statement, branch, function and line coverage. Coverage must come from behaviorally meaningful assertions, not unreachable-code tricks, broad exclusions or source rewriting.

Coverage is necessary but not sufficient. Buyer-critical persistence, browser, concurrency, migration and security boundaries require realistic integration evidence.

## 4. Persistence contract

When a change introduces or modifies PostgreSQL behavior, tests cover as applicable:

- real migration application;
- process restart durability;
- tenant separation;
- transaction rollback/partial failure;
- idempotent replay and conflicting-key reuse;
- concurrent requests/races;
- exact expiry/time-bound behavior;
- uniqueness/check/foreign-key constraints;
- migration compatibility and staged constraint finalization;
- cleanup/fixture isolation without hidden shared test state.

### Data-rights example

Protected main tests the identity data-rights ledger against PostgreSQL, including immutable terminal receipt evidence and survival of bounded receipt metadata after source user/workspace erasure.

## 5. Concurrency

Concurrency tests must exercise the actual locking/precondition mechanism, not only sequential mocks. For stale-write-sensitive state, prove both successful current writes and rejected/reconciled stale writes.

PR #127 must prove the Today aggregate's deterministic lock/revision/idempotency behavior on its exact final head before protected-main status is granted.

## 6. Authentication and authorization

Security-sensitive tests cover:

- provider/state/redirect validation;
- cross-tenant identifier substitution;
- client-supplied workspace/actor injection;
- session revocation/rotation;
- preservation of real authentication age;
- recent-auth stale/future/malformed provenance;
- signed-context method/path/tenant/time binding where used;
- missing secret/configuration fail-closed behavior.

PR #139 must prove that the calendar service no longer grants tenant authority from the legacy client-selected workspace header.

## 7. Browser and accessibility

Core browser tests cover:

- keyboard navigation and visible focus;
- semantic labels/live regions where applicable;
- mobile/responsive states;
- Korean/English structural parity;
- local draft versus durable-state labeling;
- stale async response suppression;
- conflict/error recovery without destructive implicit action.

## 8. AI/model tests

### Deterministic merge evidence

Product AI schema/operation/grounding/safety behavior uses deterministic fixtures and remains runnable without a live model provider.

### Bounded live conformance

Live NVIDIA/contextual-orchestrator evidence is scheduled/manual governance evidence. It may measure quality/control differences but provider availability is not fabricated into deterministic source correctness.

Retained evidence excludes raw prompts/responses, hidden reasoning and credentials.

## 9. Security tooling

Required or configured scanners/checks remain separate evidence channels. A scanner status is attributed to the exact commit/tree it inspected. Tool outage/rate limit/queue delay is not success and not automatically a source defect.

Issue #132 tracks the repository-wide distinction between exact contributor-head source verification and synthetic merge-tree compatibility evidence.

## 10. Migration and recovery tests

Schema changes must prove the relevant forward path and rollback/forward-fix behavior. Backup tests verify archive/checksum behavior, unsafe-target refusal and restored representative records. Logical backup evidence does not imply PITR.

## 11. Documentation contract tests

Canonical documentation tests should verify more than file presence:

- required canonical paths exist;
- root README links resolve to actual local targets;
- all canonical status fields use the exact approved vocabulary;
- ADR index links target the exact indexed ADR files;
- required ADR sections exist;
- Mermaid/Markdown fences are balanced;
- key service/API/event names match real source/configuration;
- UUIDv4 and service-owned persistence claims are supported by migrations/source;
- active PR claims name live PRs and are not promoted to protected-main status;
- canonical buyer gaps match the repository-owned buyer-gap registry and live issue state where the audit fetches it.

A resolved historical review comment is never enough to prove a later source version still satisfies the contract.

## 12. Test evidence hierarchy

For merge decisions prefer:

1. exact current contributor-head required source/security checks;
2. explicit merge-tree compatibility evidence where repository policy requires it;
3. focused deterministic local/package evidence tied to the same source tree;
4. live-provider conformance as additional governance evidence;
5. historical runs only for RCA context, never current pass promotion.

## 13. Completion rule

A change is not test-complete until the intended failure boundary has been exercised, the exact current implementation passes the focused/full required suites, review/security findings are reconciled and the final unchanged head is the head proposed for merge.