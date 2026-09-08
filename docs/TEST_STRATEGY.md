# LifeOS Test Strategy

**Status:** Implemented on active PR

## Principles

LifeOS tests prove domain behavior, authority, recovery, and evidence identity—not only implementation reachability. Source changes follow realistic RED -> smallest root-cause GREEN -> focused/full validation. Required checks are attributed to the exact revision and checkout they inspect.

A test harness is part of the evidence contract. Missing runtime builds, wrong checkout identity, skipped environment prerequisites, or purpose-workflow defects are root-caused and repaired rather than papered over with `PYTHONPATH`, broad skips, sample reduction, stale evidence, or gate weakening.

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
- compensation/recovery records where external secret material is introduced;
- active Calendar OAuth-state and Plugin origin/credential/grant persistence when those migrations are under test.

Mock-only success is insufficient for persistence, privilege, concurrency, replay, migration, or recovery claims.

### HTTP and application integration

Exercise actual authenticated/signed boundaries, exact method/path/actor/workspace binding, malformed JSON/content type/UUID/signature/cursor, replay, conflict, not-found isolation, response-size/schema validation, dependency outage, and credential-free problem mapping. Tests must prove browser-selected ownership cannot create authority.

Protected examples include Planning/Habit Today composition, Calendar read/create/disconnect/materialization, Planning/Habit/Review data-rights transport, integration events, and plugin operator HTTP composition. Active contracts add Calendar OAuth ceremony boundaries, first-party BFF/workspace flows, Vault-backed Integration composition, and delivery-origin operator application authority without promoting those active surfaces to protected truth.

### Browser acceptance

Use Playwright for material user journeys. The #209 commercial path is dependency ordered Goals → Projects → Tasks → Habits → Review and requires:

- authenticated first-party BFF transport with no browser-derived tenant authority;
- durable create/read/update evidence rather than optimistic identifiers presented as accepted state;
- normal, loading, empty, error, permission, conflict and recovery states;
- desktop/mobile/intermediate widths without overflow, clipping or unusable touch targets;
- keyboard traversal, visible focus, semantic names, live-state announcements, contrast and reduced-motion behavior;
- Figma/Storybook component/page traceability where material UI is introduced;
- KO/EN/JA/ZH/VI/ES/DE/FR screen-key resource parity, CJK/font fallback and text-expansion acceptance;
- stale overlapping-response protection and prior-safe-evidence preservation on failure.

Browser-local drafts remain visibly non-durable until server acceptance. A focused component test or ancestor browser run does not prove the final stacked current head.

### Security regression

Cover:

- tenant/actor/resource substitution;
- signed-context replay, stale/future evidence, and exact request binding;
- SQL structure/privileges and corrupt persisted evidence;
- secret/reference/log/error/artifact leakage;
- OAuth state/redirect/origin/PKCE expiry, replay, consumed-row substitution and verifier lifetime;
- provider response limits and credential material lifetime;
- AI prompt injection, benign utility, inert proposal enforcement and model-gateway authentication/bootstrap failure;
- plugin manifest self-escalation, credential/origin revocation TOCTOU, signed route confusion, hostile URL/SSRF/DNS-rebinding cases before outbound networking can ship;
- Vault plaintext/credential non-retention in durable LifeOS metadata and public evidence;
- package lifecycle-script allowlisting, workspace runtime dependency builds, and exact dependency pins;
- source/base/integration/SARIF/status/release identity attribution;
- release evidence subject/signature coverage, trust-root/key-lifecycle and provenance mismatch.

### Backup, deployment, migration, and release

Executable tests validate Compose/reference deployment sources, liveness/readiness, graceful shutdown, backup checksum/restore refusal, migration compatibility, rollback/forward-fix, package/container build, SBOM/provenance/signature/reproducibility, and publish/install verification.

## Coverage and docstrings

Packages with exact configured gates retain meaningful 100% statement, branch, function, and line coverage. Coverage cannot be satisfied through deleted behavior, broad exclusions, unreachable branches, or mock-only assertions. Public production declarations require beginner-readable explanatory documentation under the owning package's gate.

A green full test suite is not a 100% coverage claim. Coverage percentages and denominator evidence must be produced separately when the owning gate requires them.

## Authority and replay matrices

| Domain | Required adversarial/concurrency evidence | Status |
| --- | --- | --- |
| Today | duplicate idempotency, conflicting reuse, stale precondition, concurrent create/update, cleanup | Implemented on protected main |
| Planning/Habit/Review routes | workspace/actor/method/path substitution, stale/future signature, replay as applicable | Implemented on protected main |
| First-party buyer path | BFF authority, durable response validation, stale response suppression, all UI states/a11y/locales/current-head E2E | Partial |
| Notification | duplicate claim/delivery, expiry/recovery, immutable outcome | Implemented on protected main |
| AI proposals | malformed model output, stale/replayed decision, explicit confirmation, no mutation authority | Implemented on protected main |
| Privacy | purpose/resource/lifetime, exact expiry, single-use grant, bounded audit | Implemented on protected main |
| Data rights | request/idempotency collision, deterministic export, owner preflight/erase/verify, participant omission, whole-right non-completion | Partial |
| Calendar | exact connection/workspace/user evidence, secret-first compensation, handle substitution, OAuth state/PKCE replay/expiry, provider/KMS outage, local-vs-provider revoke | Partial |
| Plugin | manifest/grant conflict, exact installation/binding/origin/operator evidence, credential compensation, replay/revoke/TOCTOU; Vault+PostgreSQL lifecycle; delivery SSRF/retry when introduced | Partial |
| Release | index structure, artifact/checksum/provenance/signature subject binding, crypto verification, immutable publication, reproducibility, rollback/recovery | Partial |

## Data-rights acceptance

PR #159 protects the shared contract. Protected Planning evidence comes from PR #179 and PR #194; protected Habit evidence comes from PR #184 and PR #192; protected Review evidence comes from PR #195. PR #198 and PR #199 are **Implemented on active PR** and require exact-head real PostgreSQL, coverage, docstrings, security/review, and live-base compatibility before integration.

Whole-product tests must fail when any required participant is missing, duplicate, unavailable, malformed, cross-tenant, partially completed, unverified after erasure, or absent from the exact participant registry. Export integrity evidence never substitutes for authorization or protected delivery.

## Calendar acceptance

Protected boundaries from PR #157, PR #176, PR #189, PR #193, PR #197, PR #201 and PR #203 require tests for authenticated disconnect, exact returned lookup identity, credential-free read, secret-handle validation/materialization, secret-first create, returned-evidence compensation and encrypted self-hosted storage.

Active #216 must prove hosted multi-user runtime rejects deployment-wide Google/CalDAV credentials instead of silently treating them as user authority. Active #228 must prove exact workspace/user/provider/redirect state binding, bounded expiry, one-time consumption, hostile consumed-row rejection before PKCE secret materialization, and secret-store cleanup/partial-failure semantics within its implemented boundary.

The remaining #129 lifecycle requires real PostgreSQL OAuth-state migration/runtime evidence, callback/token exchange, successful post-exchange verifier cleanup, refresh single-flight/fencing, provider cleanup partial-failure recovery, discovery/selection bounds, scoped sync, restart/rotation, and no process-global credential fallback.

## Plugin acceptance

Protected PR #151, PR #169, PR #172, PR #175, PR #191, and PR #196 require tests for explicit grants, durable exact installation identity, opaque credential binding, conflicting-winner compensation, one-time operator authority/replay, malformed JSON, unavailable composition, and credential-free errors.

The active #130 stack additionally requires real Integration-owned PostgreSQL and Vault KV v2 lifecycle acceptance across installation, credential create/exact replay, runtime restart, installation/credential revocation and cleanup. Active delivery-origin persistence must reject inactive/mismatched installation evidence and retain exact normalized HTTPS origin identity. Active #250 must prove signed grant/read/revoke application authority, cross-route signature rejection, exact lowercase UUIDv4 route/method admission and unavailable-composition failure.

A temporary #250 verifier must build `@life-os/plugin-sdk` before the full Integration suite because its runtime package entry is `dist/index.js`. Failing to build that declared dependency is a harness RED, not grounds to skip the full suite. The purpose workflow may delete only itself after the exact proof passes.

Before #130 outbound delivery can ship, tests must cover loopback/RFC1918/ULA/link-local/cloud-metadata/IPv4-mapped/encoded addresses, DNS rebinding, connect-time resolution, redirect/proxy policy, TLS/HTTP failure, byte/time/rate/concurrency bounds, signing/rotation, delivery attempt/outcome durability, retry/dead-letter, restart, and revocation fencing.

## Model-assisted development acceptance

Protected #200 proves only the exact reviewed OpenCode bootstrap surface. Active #208 must fail closed if the released contextual-orchestrator client/gateway cannot authenticate or supply required capability. The required acceptance sequence is canonical-owner RED, owner causal fix, immutable reviewed owner release, exact LifeOS consumer bump, then hosted consumer acceptance through `orchestrator/free`. Provider/model/group hard-coding, mutable source copy, direct-provider fallback, or elapsed-time-only reasoning/tool termination are not substitutes.

## Documentation consistency

Machine-checkable contracts validate:

- required canonical files and README/index links;
- local Markdown links;
- exact maturity vocabulary;
- ADR index/targets/status/required sections;
- balanced Markdown/Mermaid fences;
- protected chronology versus active PR scope;
- current buyer gaps #55/#129/#130/#209/#210 and closed/superseded issue state;
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
5. workflow checkout/source identity;
6. protected main;
7. release source/artifact/provenance identity.

Evidence from one class cannot satisfy another. PR #154 protects local source/live-base separation. Issue #132 remains **Partial** for residual central reusable scanner checkout/SARIF/status taxonomy.

Pending, queued, skipped, cancelled, absent, neutral, failed, stale, predecessor, synthetic-only, model-only, or rate-limited evidence is non-passing.

## Release acceptance

Issue #210 remains Partial. Active Draft #217 provides structural release-evidence validation and stacked #236 detached Ed25519 verification. Final acceptance requires one unchanged protected release source to pass required CI/security/review, exact configured coverage/docstrings, browser/accessibility/localization, package/container build, version/CHANGELOG/tag/immutable publication, checksums, SBOM/provenance/signatures/trust-root lifecycle/reproducibility, compatibility, migration/rollback/recovery, backup/restore, installed runtime/buyer-path verification, and protected-main operational acceptance together.
