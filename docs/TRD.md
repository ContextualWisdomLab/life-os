# LifeOS Technical Requirements Document

**Version:** 1.0-draft  
**Baseline:** protected `main` at `dcc787f77b708cecda054b47d6f7d7b561575a67`

## 1. Purpose

This TRD defines repository-wide runtime, authority, data, security, failure, quality and release requirements. Owning-service source, migrations, tests and versioned contracts remain executable truth.

## 2. Runtime baseline

| Concern | Current contract |
| --- | --- |
| Web | Next.js + React + TypeScript |
| Gateway/services | TypeScript bounded-service patterns |
| Workspace | pnpm + Turborepo |
| Durable persistence | PostgreSQL |
| Durable asynchronous transport | NATS JetStream where required |
| Local/self-hosted composition | Docker Compose |
| Production reference | Kubernetes/Kustomize |
| Model-backed assistance/development | Approved AI/OpenCode boundary using `NVIDIA_NIM_API_KEY` where required |

## 3. Bounded-context authority

- **Web/PWA:** interaction state plus explicit draft/cache/offline state; never a direct DB client.
- **Gateway/BFF:** public composition/authentication context, not a shared domain store.
- **Identity:** users, provider mappings, sessions, workspace authorization, authentication provenance, data-rights request ledger/status lookup.
- **Planning:** goals, projects, tasks, search and durable Today state.
- **Habit:** recurrence definitions and completion evidence.
- **Review:** review snapshots/projections, not planning mutation authority.
- **Notification:** reminder occurrence/claim/delivery/outcome evidence.
- **Calendar integration:** provider adaptation and synchronization; trusted workspace context is protected main; full hosted credentials remain Partial.
- **AI:** proposal generation/evidence/decisions/quality evaluation; no generic planning mutation repository.
- **Privacy:** purpose-bound decisions/grants/events.
- **Plugin integration:** contract discovery/validation/preparation; generic runtime delivery remains Planned.

## 4. Data requirements

### TRD-DATA-001 — Service-owned persistence

Each service owns migrations, persistence adapters and credentials. Direct cross-service table reads/writes are prohibited. Cross-service consistency uses APIs/events/sagas and explicit reconciliation.

### TRD-DATA-002 — Identifiers

Internal durable IDs are opaque UUIDv4. Provider-native IDs remain explicit external mappings.

### TRD-DATA-003 — Naming

Product-owned database objects use descriptive two-or-more-word `snake_case` names unless an external protocol mandates another spelling.

### TRD-DATA-004 — Time semantics

Persist instants in UTC and retain IANA/local civil-time fields where domain behavior depends on local date/time. Authentication ceremony time, session issuance, provider expiry and domain occurrence time are separate meanings.

### TRD-DATA-005 — Immutability, replay and concurrency

Append-only/immutable audit, decision, completion and receipt evidence rejects incompatible mutation. Mutable state uses explicit revision, digest, ETag, idempotency or fencing where duplicate effects/lost update are plausible.

## 5. Authentication and authorization

- OAuth callbacks validate provider/state/redirect boundaries.
- Browser sessions are revocable and server-verifiable.
- Compatible session rotation preserves the authentication instant.
- Recent-authentication gates evaluate authentication age rather than bearer/session age.
- Client-supplied workspace/actor headers are never tenant authority.
- Security-sensitive internal context binds actor/workspace/method/path and bounded issuance time where required.
- Calendar/plugin/provider credentials are separate from login sessions and require their own storage/refresh/revocation lifecycle.

## 6. HTTP and event contracts

HTTP boundaries:

1. bound untrusted input;
2. derive ownership from trusted context;
3. use replay protection for repeatable mutations;
4. use explicit stale-write preconditions where required;
5. return bounded credential-free errors;
6. never expose stack traces, SQL, tokens or unbounded provider bodies;
7. version breaking semantics.

Events use explicit type/version, opaque event identity, bounded tenant/correlation context and replay-safe consumers. Receiving an event never grants producer-database authority.

See `docs/API_CONTRACTS.md`.

## 7. Domain concurrency/replay contracts

### Durable Today

**Status:** Implemented on protected main

Workspace/date-scoped Today writes use explicit preconditions, opaque revision/idempotency identity, deterministic transaction-scoped PostgreSQL locking and fresh post-lock replay/conflict checks. Browser-local drafts are uploaded only through explicit user action; later local edits are not silently replaced by an older in-flight response.

### Data rights

**Status:** Implemented on protected main

Identity preserves recent-authentication semantics and durable request identity/replay/conflict/immutable terminal receipt evidence. Tenant-scoped status lookup is also protected-main behavior after PR #144. Complete multi-domain export/erasure remains issue #55.

### Calendar

**Status:** Partial

Provider synchronization and trusted signed LifeOS workspace context are protected-main behavior. Issue #129 still requires encrypted per-user connection credentials, OAuth state/PKCE, refresh/revocation, discovery/selection and migration from the development token.

### Plugins

**Status:** Planned

Issue #130 owns installation grants, secret handles, origin/SSRF policy, delivery/retry/audit and revocation.

## 8. AI and autonomous-development requirements

- Model output is untrusted inert proposal data.
- Deterministic validators/product authorization remain authoritative.
- No AI route silently mutates user planning data.
- Live provider availability is not fabricated into deterministic merge correctness.
- A strong single-model route is the required baseline; deeper orchestration needs measured quality/control benefit.
- Model-assisted repository development never receives product data authority, review secrets, Docker-socket authority or merge/release administration.

## 9. Security and privacy

- Treat external/provider/model/plugin/connector/stored JSON input as untrusted until bounded and validated.
- Keep SQL structure fixed and parameterize values.
- Apply least privilege to GitHub/runtime/database/provider credentials.
- Keep credentials, browser cookies, raw prompts/responses/hidden reasoning and unbounded tenant content out of retained public artifacts.
- Sensitive access binds tenant/actor/resource/purpose/lifetime and audit evidence.
- Data-rights ledger rows contain bounded IDs/digests/status/timestamps rather than export payloads.

## 10. Web/PWA/accessibility/localization

- Core journeys are keyboard operable with visible focus.
- Essential state is not color-only.
- Korean/English catalogs stay structurally aligned.
- Browser-local state never implies durable success before server acceptance.
- Stale async responses cannot replace newer owned UI state.

## 11. Operability, backup and migration

- Health/readiness reflect actual service responsibility.
- Metrics are operator surfaces; public ingress restricts them.
- Logs are bounded and credential-free.
- Migrations include existing-data compatibility and rollback/forward-fix evidence appropriate to risk.
- Logical backup/restore verifies integrity and safe targets; it does not imply PITR.
- Compose/Kubernetes references do not erase operator responsibility for PostgreSQL, NATS, DNS/TLS, registry, secret manager and provider configuration.

## 12. Test requirements

- Unit tests for deterministic invariants and malformed input.
- Real PostgreSQL tests for durability, tenancy, replay, concurrency, expiry and migration where persistence matters.
- HTTP integration tests for actual authority/error boundaries.
- Browser E2E for buyer journeys, accessibility/localization/PWA behavior.
- Security regressions for trust boundaries and scanner classes.
- Deterministic gates separated from bounded live-provider evidence.
- Packages declaring exact gates maintain meaningful 100% statement/branch/function/line coverage.
- Canonical docs tests validate links, exact statuses, ADR targets and selected source/migration claims.

## 13. Release requirements

A stable release requires one exact protected integrated head where applicable CI/security/review, coverage, packaging/container, migration/recovery, accessibility/browser, SBOM/provenance and canonical buyer-gap/release evidence pass together with no valid unresolved finding.