# LifeOS Test Strategy

**Status:** Implemented on active PR

## Principles

LifeOS tests prove domain behavior, authority, recovery, and evidence identity—not only implementation reachability. Source changes follow realistic RED -> smallest root-cause GREEN -> focused/full validation. Required checks are attributed to the exact revision and checkout they inspect.

## Test layers

### Unit and domain

Validate UUIDv4, authority derivation, exact method/path signing, freshness, one-time evidence, digest/cursor normalization, recurrence, idempotency, fencing, stale preconditions, state transitions, and bounded failure classes with deterministic tests.

### PostgreSQL integration

Use real disposable PostgreSQL for service-owned migrations and repositories, including:

- tenant isolation and fixed parameterized SQL;
- exact returned identity/evidence validation;
- transaction rollback and restart durability;
- concurrent/replayed requests and advisory/fencing semantics;
- immutable proposal/decision/reminder/receipt/audit evidence;
- owner-only destructive data-rights functions and post-erasure verification;
- privilege denial for ordinary application roles;
- compensation/recovery records where external secret material is introduced.

Mock-only success is insufficient for persistence, privilege, concurrency, replay, migration, or recovery claims.

### HTTP and application integration

Exercise actual authenticated/signed boundaries, exact method/path/actor/workspace binding, malformed JSON/content type/UUID/signature/cursor, replay, conflict, not-found isolation, response-size/schema validation, dependency outage, and credential-free problem mapping. Tests must prove browser-selected ownership cannot create authority.

Protected examples include Planning/Habit Today composition, Calendar read/create/disconnect/materialization, Planning/Habit data-rights transport, integration events, and plugin operator HTTP composition.

### Browser acceptance

Use Playwright for material user journeys: login/onboarding, capture/Today, durable synchronization/conflict, explicit degraded state, accessibility, localization, and PWA behavior. Browser-local drafts must remain visibly non-durable until server acceptance.

### Security regression

Cover:

- tenant/actor/resource substitution;
- signed-context replay, stale/future evidence, and exact request binding;
- SQL structure/privileges and corrupt persisted evidence;
- secret/reference/log/error/artifact leakage;
- OAuth state/redirect/origin/PKCE when introduced;
- provider response limits and credential material lifetime;
- AI prompt injection, benign utility, and inert proposal enforcement;
- plugin manifest self-escalation, operator replay, and hostile URL/SSRF/DNS-rebinding cases before outbound networking can ship;
- package lifecycle-script allowlisting and exact dependency pins;
- source/base/integration/SARIF/status identity attribution.

### Backup, deployment, migration, and release

Executable tests validate Compose/reference deployment sources, liveness/readiness, graceful shutdown, backup checksum/restore refusal, migration compatibility, rollback/forward-fix, package/container build, SBOM/provenance/reproducibility, and publish verification.

## Coverage and docstrings

Packages with exact configured gates retain meaningful 100% statement, branch, function, and line coverage. Coverage cannot be satisfied through deleted behavior, broad exclusions, unreachable branches, or mock-only assertions. Public production declarations require beginner-readable explanatory documentation under the owning package's gate.

## Authority and replay matrices

| Domain | Required adversarial/concurrency evidence | Status |
| --- | --- | --- |
| Today | duplicate idempotency, conflicting reuse, stale precondition, concurrent create/update, cleanup | Implemented on protected main |
| Planning/Habit/Review routes | workspace/actor/method/path substitution, stale/future signature, replay as applicable | Implemented on protected main |
| Notification | duplicate claim/delivery, expiry/recovery, immutable outcome | Implemented on protected main |
| AI proposals | malformed model output, stale/replayed decision, explicit confirmation, no mutation authority | Implemented on protected main |
| Privacy | purpose/resource/lifetime, exact expiry, single-use grant, bounded audit | Implemented on protected main |
| Data rights | request/idempotency collision, deterministic export, owner preflight/erase/verify, participant omission, whole-right non-completion | Partial |
| Calendar | exact connection/workspace/user evidence, secret-first compensation, handle substitution, provider/KMS outage, local-vs-provider revoke | Partial |
| Plugin | manifest/grant conflict, exact installation/binding/operator evidence, credential compensation, replay/revoke; delivery SSRF/retry when introduced | Partial |

## Data-rights acceptance

PR #159 protects the shared contract. Protected Planning evidence comes from PR #179 and PR #194; protected Habit evidence comes from PR #184 and PR #192. PR #195, PR #198, and PR #199 are **Implemented on active PR** and require exact-head real PostgreSQL, coverage, docstrings, security/review, and live-base compatibility before integration.

Whole-product tests must fail when any required participant is missing, duplicate, unavailable, malformed, cross-tenant, partially completed, unverified after erasure, or absent from the exact participant registry. Export integrity evidence never substitutes for authorization or protected delivery.

## Calendar acceptance

Protected boundaries from PR #157, PR #176, PR #189, PR #193, and PR #197 require tests for authenticated disconnect, exact returned lookup identity, credential-free read, secret-handle validation/materialization, secret-first create, and compensation on persistence/secret-store failures.

PR #201 protects returned-durable-evidence mismatch compensation. The remaining #129 lifecycle requires OAuth state/PKCE replay tests, concrete encrypted-store evidence, refresh single-flight/fencing, provider cleanup partial-failure recovery, discovery/selection bounds, scoped sync, restart/rotation, and no process-global credential fallback.

## Plugin acceptance

Protected PR #151, PR #169, PR #172, PR #175, PR #191, and PR #196 require tests for explicit grants, durable exact installation identity, opaque credential binding, conflicting-winner compensation, one-time operator authority/replay, malformed JSON, unavailable composition, and credential-free errors.

Before #130 outbound delivery can ship, tests must cover host-authorized origins, loopback/RFC1918/ULA/link-local/cloud-metadata/IPv4-mapped/encoded addresses, DNS rebinding, redirect/proxy policy, TLS/HTTP failure, byte/time/rate/concurrency bounds, signing/rotation, retry/dead-letter, restart, and revocation fencing.

## Documentation consistency

Machine-checkable contracts validate:

- required canonical files and README/index links;
- local Markdown links;
- exact maturity vocabulary;
- ADR index/targets/status/required sections;
- balanced Markdown/Mermaid fences;
- protected chronology versus active PR scope;
- current buyer gaps and closed/superseded issue state;
- conceptual versus persisted/active data-model labels;
- UUIDv4, service ownership, browser durability, inert AI, purpose-bound privacy, and evidence-identity invariants;
- model credential/orchestration/review authority boundaries;
- stale predecessor PRs cannot reappear as active truth.

## Evidence identity

A check must identify whether it inspected:

1. exact contributor source head;
2. PR-base snapshot;
3. independently resolved live-base tip;
4. synthetic/integration tree;
5. protected main;
6. release artifact/provenance.

Evidence from one class cannot satisfy another. PR #154 protects local source/live-base separation. Issue #132 remains **Partial** for residual central reusable scanner checkout/SARIF/status taxonomy.

Pending, queued, skipped, cancelled, absent, neutral, failed, stale, predecessor, synthetic-only, model-only, or rate-limited evidence is non-passing.

## Live-provider separation

NVIDIA/model/provider availability supplies bounded conformance evidence, not deterministic PR success. Deterministic fixtures prove quality/safety and provider failure behavior. `NVIDIA_NIM_API_KEY` materializes only inside the approved model boundary. PR #200 is **Implemented on protected main** for the narrow exact-pinned OpenCode postinstall allowlist; a fresh protected scheduled run remains operational acceptance evidence rather than merge evidence.

## Release acceptance

A release candidate must pass required CI/security/review, exact configured coverage/docstrings, browser/accessibility/localization, package/container build, compatibility, migration/rollback/recovery, backup/restore, SBOM/provenance/reproducibility, and protected-main operational acceptance on one unchanged integrated revision.
