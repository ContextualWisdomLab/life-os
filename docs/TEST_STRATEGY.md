# LifeOS Test Strategy

**Status:** Implemented on active PR

## Principles

LifeOS tests prove domain behavior and authority boundaries, not only implementation reachability. Source changes follow RED -> minimal GREEN -> refactor where practical. Required checks are attributed to the revision they actually inspect.

## Test layers

### Unit/domain

Validate UUIDv4, ownership, signatures, digests, recurrence, idempotency, stale preconditions, state transitions and bounded failure classes with deterministic tests.

### PostgreSQL integration

Use real PostgreSQL for service-owned persistence behavior, including tenant isolation, transactions, concurrent/replayed requests, immutable evidence, migration compatibility and restart durability.

Current examples include durable planning/Today concurrency, habit persistence, notification claim/outcome behavior, AI/privacy persistence and identity data-rights ledgers.

### HTTP integration

Exercise actual authenticated/signed request boundaries, malformed input, content type, conflict and dependency-failure semantics. Tests must prove that client-selected ownership cannot create authority.

### Browser acceptance

Exercise real core journeys with Playwright where the user-visible contract is material: login/onboarding, capture/Today, durable Today synchronization/conflicts, accessibility/localization and PWA behavior.

### Security regression

Cover AppGuardrail/Semgrep/security classes, SQL/static structure, context signing, tenant substitution, untrusted provider responses, prompt injection, secret leakage, hostile URLs where networking is introduced, and bounded error/artifact behavior.

### Backup/deployment/release

Executable tests validate Compose/reference deployment sources, liveness/readiness, backup checksum/restore refusal and package/release/provenance contracts.

## Coverage

Packages with exact gates retain meaningful 100% statement, branch, function and line coverage. Coverage cannot be satisfied by deleting real behavior, broad exclusions or mock-only assertions. Public production declarations require explanatory documentation under the owning package's configured gate.

## Concurrency and replay matrix

- Today: duplicate idempotency key, conflicting reuse, stale precondition, concurrent create/update, connection cleanup.
- Habit: duplicate completion and tenant conflict.
- Notification: duplicate claim/delivery, expiry/recovery.
- AI: stale/replayed proposal decisions.
- Privacy: exact-expiry and single-use grant behavior.
- Data rights: request collision, immutable receipt, tenant-scoped lookup, future async reconciliation.
- Calendar: provider preconditions and trusted-context replay/issuance bounds.

## Evidence identity

A test/check must identify whether it inspected:

1. exact contributor source head;
2. synthetic merge candidate;
3. independently resolved live-base compatibility state;
4. protected main;
5. release artifact.

Evidence from one class cannot silently satisfy another. Issue #132 tracks the repository-wide required-workflow source-head attribution follow-up.

## Documentation consistency

Machine-checkable documentation tests should validate:

- required canonical files and README/index links;
- all local Markdown link targets;
- exact status vocabulary;
- ADR index, actual targets, statuses and required sections;
- balanced Mermaid/Markdown fences;
- live service/API/event/state names;
- conceptual-vs-persisted labels in the data model;
- source/migration evidence for core claims such as UUIDv4, service-owned persistence and inert AI authority;
- active-PR versus protected-main lifecycle claims.

## Live-provider separation

NVIDIA/model/provider availability is bounded conformance evidence, not deterministic PR success. Deterministic fixtures test proposal safety/quality and provider failure behavior. `NVIDIA_NIM_API_KEY` is materialized only for the approved live model boundary.

## Release acceptance

A release candidate must pass required CI/security/review, exact configured coverage, browser/accessibility/localization evidence, package/container build, migration/rollback/recovery, backup/restore, SBOM/provenance/reproducibility and protected-main operational acceptance on one exact integrated revision.