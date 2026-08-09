# LifeOS Technical Requirements Document

**Version:** 1.0-draft  
**Baseline:** protected `main` at `f4cae6d83eadb00019d2962a650c55c59a3349ae`

## 1. Purpose

This document defines repository-wide technical requirements. Owning-service source, migrations and versioned contracts remain the executable source of truth. This TRD states the shared authority, runtime, data, security, failure, quality and release properties those artifacts must preserve.

## 2. Current architecture

LifeOS is a TypeScript-first monorepo with a Next.js web/PWA, gateway/BFF and domain-oriented services. PostgreSQL is the durable system of record for persisted bounded contexts. NATS JetStream supports versioned asynchronous events where durable messaging is justified.

Current bounded contexts include identity, planning, habits, reviews, notifications, calendar integration, plugin integration, AI proposals/audit and privacy. Services can share physical infrastructure when operated that way, but they do not gain cross-service table authority from co-location.

## 3. Technology baseline

| Concern | Current contract |
| --- | --- |
| Web | Next.js + React + TypeScript |
| Gateway/services | TypeScript service boundaries following existing repository patterns |
| Workspace | pnpm + Turborepo |
| Durable persistence | PostgreSQL |
| Event transport | NATS JetStream when asynchronous durability is required |
| Local/self-hosted composition | Docker Compose |
| Production reference | Kubernetes/Kustomize artifacts and runbooks |
| Model-backed assistance | Approved LifeOS AI/OpenCode boundary; `NVIDIA_NIM_API_KEY` where model access is required |
| Observability | Structured bounded logs, correlation/evidence identifiers and operator metrics where implemented |

## 4. Authority boundaries

### Web / PWA

Owns interaction state and explicitly local draft/cache state. It is not a direct database client and cannot claim durable acceptance before the owning service confirms it.

### Gateway / BFF

Owns public request composition and trusted authentication context derivation. It is not a hidden shared domain store.

### Identity service

Owns users, external identity mappings, browser sessions, workspace authorization context, authentication-age provenance and the durable data-rights request ledger.

### Planning service

Owns goals, projects, milestones/tasks, planning search and durable Today state. Other services do not mutate planning tables directly.

### Habit service

Owns habit definitions, recurrence semantics and completion evidence.

### Review service

Owns review snapshots/projections. It consumes evidence without becoming planning/habit mutation authority.

### Notification service

Owns reminder occurrences, claims, immutable outcomes and in-app delivery/retry state.

### Calendar integration service

Owns provider adaptation and synchronization state. The full hosted per-user credential lifecycle remains `Partial`; trusted workspace context is being advanced on active PR #139.

### AI proposal service

Owns bounded proposal generation, immutable proposal evidence, explicit decisions and proposal-quality evaluation. It has no generic planning mutation repository.

### Privacy service

Owns purpose-bound access decisions/grants/events and signed sensitive-access boundaries.

### Plugin integration service / SDK

Owns contract discovery, manifest/event validation and event preparation. Installation grants, durable secrets and outbound runtime delivery remain a separate planned trust boundary.

## 5. Data requirements

### TRD-DATA-001 — Service-owned persistence

Each bounded service owns its persistence schema/database namespace, migrations and credentials. Direct cross-service table reads/writes are prohibited. Cross-service relationships are logical references resolved through versioned contracts/events/sagas.

### TRD-DATA-002 — Identifiers

Internal durable identifiers are opaque UUIDv4 values. Provider-native numeric/string identifiers are explicit external mappings, never hidden internal primary keys.

### TRD-DATA-003 — Naming

Product-owned database objects use descriptive two-or-more-word `snake_case` names unless an external standard mandates another spelling.

### TRD-DATA-004 — Time

Persist instants in UTC and retain IANA timezone/local civil-time fields when the domain depends on local date/time. Authentication age, session issuance, event occurrence and provider expiry are separate temporal meanings and must not be silently conflated.

### TRD-DATA-005 — Immutability and concurrency

Audit/decision/completion/receipt evidence defined as immutable or append-only rejects incompatible mutation. Mutable state uses explicit revision, digest, ETag, idempotency or fencing evidence wherever duplicate side effects or silent stale overwrite are plausible.

## 6. Authentication and authorization

- OAuth callbacks validate state/redirect/provider boundaries.
- Browser sessions are revocable and server-verifiable.
- Session rotation preserves the original authentication instant when the same authentication ceremony remains authoritative.
- Recent-authentication gates evaluate authentication age, not session age.
- Browser-selected workspace/actor headers are not authority.
- Signed internal context binds actor/workspace/method/path and bounded issuance time where required.
- Calendar/provider credentials are distinct from login credentials and require independent storage, refresh, rotation and revocation semantics.

## 7. HTTP/API requirements

1. Bound untrusted request size before retaining it where practical.
2. Derive ownership from trusted authenticated/signed context.
3. Use idempotency for realistically replayable mutations.
4. Require explicit stale-write preconditions where silent overwrite is unacceptable.
5. Return bounded credential-free errors.
6. Never expose dependency bodies, stack traces, tokens or secrets to clients.
7. Restrict security-sensitive redirects/origins and provider endpoints.
8. Version breaking semantics instead of silently widening shared contracts.

See `docs/API_CONTRACTS.md`.

## 8. Event requirements

When a domain event is used:

- type and schema version are explicit;
- event IDs are opaque and unique;
- actor/workspace/correlation/causation context is bounded and validated;
- published payloads are immutable;
- consumers tolerate replay/at-least-once delivery idempotently;
- transactional publication uses an outbox/equivalent boundary when atomicity with a database mutation is required;
- receiving an event does not grant producer-database authority.

## 9. Domain concurrency contracts

### Today planning

**Status:** Implemented on protected main

The durable Today aggregate uses explicit revision/precondition and idempotency semantics, deterministic transaction-scoped advisory locking, fresh post-lock replay/conflict checks and an explicit local-draft-to-workspace user action. PR #127 merged as `f4cae6d83eadb00019d2962a650c55c59a3349ae`; issue #121 is closed completed.

### Habit completion

Exact duplicate completion submissions are replay-safe and tenant scoped.

### Notifications

Claims expire/fence safely, outcomes are immutable where specified and delivery identifiers prevent uncontrolled duplicate effects.

### Calendar

Provider updates use deterministic identifiers and strong preconditions where the provider exposes them. Client-selected workspace identity must not become tenant authority; PR #139 advances this boundary.

### AI decisions

Acceptance/rejection binds exact proposal identity/revision/digest, actor, workspace and idempotency identity.

### Data rights

Recent-authenticated ownership is enforced independently from session rotation. Durable requests use workspace-scoped idempotency, stable request identity, request digest and immutable terminal receipt evidence. Broader multi-domain export/erasure orchestration remains issue #55.

## 10. Security and privacy

- Treat external responses, model output, environment values, connector data, stored JSON, calendar/plugin payloads and decoded database rows as untrusted until validated.
- Keep SQL structure fixed and dynamic values parameterized.
- Apply least privilege to GitHub, runtime, database and provider credentials.
- Bound subprocess/network/file/model operations by time/size where exhaustion is plausible.
- Retained CI/public/model artifacts exclude credentials, browser cookies, raw prompts/responses, hidden reasoning and unnecessary tenant content.
- Purpose-bound sensitive access binds actor, workspace, resource, purpose and lifetime with auditable evidence.
- Data-rights durable receipts retain bounded opaque/digest evidence rather than exported personal payloads.

## 11. Model and autonomous-development boundaries

### Product AI

Model output is untrusted structured proposal data. Deterministic schema/business/authorization validation remains authoritative. AI cannot silently mutate user-owned planning data.

### Live model evidence

Live-provider availability is separate from deterministic merge correctness. Provider failures are represented as unavailable evidence rather than fabricated pass/fail results.

### Repository development automation

The OpenCode/NVIDIA loop may create bounded reviewed changes through its designed trusted wrapper but is not product-data, branch-protection, merge, release or repository-administration authority. Model processes do not receive GitHub/review/browser credentials or Docker-socket authority.

## 12. Web/PWA/accessibility/localization

- Core flows are keyboard operable with visible focus.
- Essential state is not represented by color alone.
- Korean/English catalogs remain structurally aligned.
- PWA/local drafts never imply durable synchronization until server acceptance is proven.
- Stale asynchronous UI responses cannot replace newer owned state after navigation/query/unmount changes.
- Durable Today browser flows preserve edits made while a save is in flight and separate retry/conflict states from local draft ownership.

## 13. Observability

- Health/readiness reflect the actual responsibility of each service.
- Metrics are operator surfaces and production ingress restricts them.
- Logs are structured, bounded and credential-free, avoiding unnecessary personal text.
- Errors distinguish validation/authentication/authorization/conflict/rate-limit/dependency/unexpected classes without leaking dependency internals.
- Numeric SLO/SLA claims exist only where measured and scoped.

## 14. Backup, migration and deployment

- Schema changes include forward compatibility plus rollback or forward-fix evidence appropriate to risk.
- Logical backup produces integrity evidence and restore rejects corruption/unsafe targets.
- Logical dumps do not imply PITR; WAL/archive/replication remain operator responsibilities until explicitly implemented.
- Application rollback claims do not imply automatic reversal of completed database migrations or external side effects.
- Compose is a composition profile, not permission to collapse service data ownership.
- Kubernetes artifacts are a provider-neutral reference and do not magically provision cluster/database/NATS/ingress/TLS/DNS/registry/secret-manager dependencies.

## 15. Test requirements

- Unit tests cover deterministic invariants and hostile malformed input.
- PostgreSQL tests cover durability, tenancy, transactions, replay, concurrency, expiry and recovery where persistence is introduced.
- HTTP integration tests cover actual authority and error boundaries.
- Browser E2E tests cover buyer journeys, accessibility/localization/PWA semantics where relevant.
- Security regressions cover known scanner classes and trust boundaries.
- Deterministic merge gates remain separate from bounded live-provider evidence.
- Packages declaring exact gates maintain meaningful 100% statement/branch/function/line coverage.
- Canonical documentation tests validate actual links, exact status vocabulary, ADR targets and selected claims against real source/migration evidence.

## 16. Release requirements

A stable release requires one exact protected integrated head with all applicable CI/security/review/coverage/package/container/migration/recovery/accessibility/SBOM/provenance evidence passing together and no valid unresolved finding. Version and `CHANGELOG.md` release sections move only after that integrated evidence exists.