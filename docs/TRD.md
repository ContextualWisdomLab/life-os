# LifeOS Technical Requirements Document

**Version:** 1.0-draft  
**Baseline:** protected `main` at `876850018a17323900844e79845ba395b7bf6a9a`

## 1. Purpose

This document defines repository-wide technical requirements for LifeOS. It does not replace owning-service source, migrations, versioned API/event schemas, or scoped runbooks. It defines the common runtime, authority, data, security, failure, quality, deployment, and release contracts those artifacts must satisfy.

## 2. Architecture status

LifeOS is a TypeScript-first monorepo containing a Next.js web/PWA, gateway/BFF, and independently bounded services. PostgreSQL is the durable system of record for persisted domains. NATS JetStream is available for versioned asynchronous events. Optional external providers include Google/GitHub identity, Google Calendar/CalDAV, and model providers through approved AI boundaries.

Protected main currently includes:

- web/PWA and gateway;
- identity/OAuth/session boundaries;
- durable planning/search and Today UX foundations;
- recurring habit persistence/completion;
- guided review;
- calendar provider adapters;
- durable notification scheduling/delivery;
- AI proposal persistence, decisions, evaluation, contextual-orchestrator transport, and bounded NVIDIA NIM conformance;
- plugin contract discovery/validation/preparation;
- purpose-bound privacy access;
- PostgreSQL logical backup/restore;
- provider-neutral Kubernetes reference deployment;
- AppGuardrail/security/commercial-readiness gates;
- the bounded hourly OpenCode commercial-development workflow and deterministic commercial-development package merged from PR #122 as `876850018a17323900844e79845ba395b7bf6a9a`.

The OpenCode workflow is repository automation, not product-data mutation authority. It still opens reviewed work subject to normal exact-head gates.

## 3. Technology baseline

| Concern | Requirement |
| --- | --- |
| Web | Next.js + React + TypeScript |
| Gateway/domain services | Existing NestJS/TypeScript-compatible service patterns |
| Workspace | pnpm + Turborepo |
| Durable database | PostgreSQL |
| Event transport | NATS JetStream when asynchronous durability is required |
| Local composition | Docker Compose |
| Production reference | Kubernetes/Kustomize provider-neutral reference |
| Observability | structured logs, correlation IDs, Prometheus-compatible metrics and scoped SLO/OpenTelemetry contracts where implemented |
| AI/model access | approved OpenCode/contextual-orchestrator boundary using `NVIDIA_NIM_API_KEY` where model access is required |

New dependencies require demonstrated product or operational value and cannot create a competing authority for an existing bounded context.

## 4. Bounded contexts and authority

### Web / PWA

Owns interaction state and explicitly browser-local drafts/caches. It never becomes a direct database client or durable domain authority.

### Gateway / BFF

Owns public composition/authentication routing. It may derive and sign context, but it is not a hidden shared domain database or generic mutation bus.

### Identity service

Owns LifeOS user identity, external identity mapping, browser sessions, workspace membership/authorization context, and provider login boundaries. External numeric/provider IDs never become internal primary keys.

### Planning service

Owns goals, projects, milestones, tasks, planning search, Today-related durable planning state, and planning mutation rules. Review, AI, notification, and integration services cannot update planning tables directly.

### Habit service

Owns habit definitions, recurrence behavior, completion evidence, and habit persistence.

### Review service

Owns review snapshots/projections/observations. It consumes evidence without becoming planning/habit source-of-truth authority.

### Calendar integration service

Owns provider adaptation and calendar synchronization state. Hosted per-user encrypted Google credential lifecycle/provider selection is **Partial** and tracked by issue #129.

### Notification service

Owns reminder occurrences, expiring claims, immutable outcomes, in-app delivery, timezone/fatigue/retry behavior, and worker recovery.

### AI proposal service

Owns bounded proposal generation, immutable proposal evidence, explicit accept/reject history, and deterministic proposal-quality evaluation. It has no generic planning mutation repository.

### Privacy service

Owns purpose-bound access decisions, grants, events, signed sensitive-access boundaries, and their persistence contract.

### Plugin integration service / SDK

Owns plugin contract discovery, manifest/event validation, event preparation, and SDK types. Generic plugin installation, durable secrets, outbound delivery, and arbitrary commands are separately governed future capabilities.

## 5. Data and identity requirements

### TRD-DATA-001 — Service-owned persistence

Each bounded service owns its database schema/migrations and credentials. Direct cross-service table reads/writes are prohibited. Shared IDs may form logical relationships but do not create hidden cross-service foreign-key authority.

### TRD-DATA-002 — Internal identifiers

Internal durable identifiers are opaque UUIDv4 under the current protected-main contract. Provider/native identifiers are stored only through explicit mappings.

### TRD-DATA-003 — Database naming

Product-owned database objects use descriptive multiword `snake_case` names unless an external protocol requires another spelling.

### TRD-DATA-004 — Time

Persist instants in UTC and retain IANA timezone/local-calendar values where civil-time semantics matter. Notification/habit logic cannot assume every local day is 24 hours.

### TRD-DATA-005 — Immutability and concurrency

Audit/decision/completion/outcome evidence defined as immutable/append-only rejects unauthorized mutation. Mutable data uses explicit revision, digest, ETag, idempotency, or fencing evidence wherever silent stale overwrite or duplicate side effects are plausible.

## 6. Authentication and authorization

- OAuth callbacks validate provider/state/redirect boundaries.
- Browser sessions are revocable and server-verifiable according to identity-service.
- Browser-selected workspace/actor headers are never trusted as authority.
- Signed private context binds the exact actor/workspace/method/path and bounded lifetime where required.
- Sensitive operations require purpose/resource/tenant authorization in addition to authentication.
- Integration credentials are distinct from login credentials and need independent storage, refresh, rotation, and revocation lifecycles.

## 7. HTTP/API requirements

1. Bound public/internal input before retaining untrusted bodies where practical.
2. Derive ownership from authenticated/signed context.
3. Use idempotency or equivalent replay protection for realistically repeatable mutations.
4. Use explicit stale-write preconditions where silent overwrite is unacceptable.
5. Return bounded credential-free problems/errors.
6. Do not expose stack traces, dependency bodies, tokens, or secrets.
7. Explicitly control redirects/origins for security-sensitive provider/model transport.
8. Version breaking semantics instead of silently changing a shared schema.

See `docs/API_CONTRACTS.md`.

## 8. Event requirements

When domain events are used:

- event IDs are opaque and unique;
- type/version is explicit;
- actor/workspace/correlation/causation context is bounded and validated;
- payloads are immutable after publication;
- consumers are idempotent under replay/at-least-once delivery;
- database-to-event publication uses an outbox/equivalent reliability boundary where atomic effect is required;
- receiving an event never grants direct mutation authority over the producer's database.

## 9. Concurrency and idempotency by domain

### Planning / Today

Durable writes reject or reconcile stale state. Browser-local drafts remain visibly distinct from durable state until explicit synchronization succeeds. Complete multi-device durable Today aggregate conflict/reconnect behavior remains **Partial** / issue #121.

### Habit completion

Use tenant-scoped idempotency and concurrency-safe persistence so duplicates/concurrent submissions resolve to one valid completion lifecycle.

### Notifications

Claims are fenced/expiring, delivery IDs replay-safe, and duplicate delivery or immutable-outcome mutation is rejected.

### Calendar

Use deterministic provider identifiers and strong preconditions/ETags where available. Provider responses are untrusted and bounded.

### AI decisions

Bind accept/reject to exact proposal revision/digest, actor, workspace, and idempotency identity. Stale proposals cannot be silently accepted as current.

### Privacy grants

Time-bounded/single-use grants fail closed at exact expiry/consumption and cannot be repurposed across actor/purpose/resource.

## 10. AI and autonomous-development requirements

### Product AI authority

- Model output is untrusted structured data.
- Deterministic validators/product authorization remain authoritative.
- AI cannot silently mutate user-owned planning data.
- Proposal evaluation independently covers validity, operation conformance, grounding, utility, leakage, and prompt-injection resistance as implemented.

### Live provider separation

- Live provider availability is not fabricated into a deterministic merge pass.
- Provider absence/outage returns sanitized unavailable evidence.
- `NVIDIA_NIM_API_KEY` is scoped only to the approved model boundary.
- Browser/session/GitHub/review-agent credentials never become model inputs or retained model artifacts.

### Orchestration

A strong single-route model is the mandatory baseline. Deeper orchestration exposes workflow stage, reasoning effort, decomposition, recursion, roles, and access topology and is justified by measured quality/control benefit.

### Repository autonomous development

The merged OpenCode scheduler:

- runs on an hourly/manual cadence;
- selects bounded repository-owned work under deterministic policy;
- isolates untrusted issue/model content;
- verifies exact base/diff/path/content/test authority before remote mutation;
- may create one draft PR through its reviewed credentialed boundary;
- cannot treat model output as merge/release/repository-administration authority;
- remains subject to normal CI, AppGuardrail, Semgrep, Security Scan, CodeRabbit/review, and exact-head merge policy.

## 11. External integration requirements

### Identity providers

Provider registration/redirect policy/secrets are operator-owned inputs. Provider outage degrades new login/link operations, not unrelated authenticated domain state where a valid session remains usable.

### Calendar providers

CalDAV/Google adapters validate provider origin/response/ETag and expose only reviewed operations. Hosted unattended multi-user Google synchronization cannot be called complete until #129 proves encrypted per-user credential storage/refresh/revocation/discovery/selection.

### Plugins

Manifests/events are bounded, versioned, tenant scoped, and have no direct DB authority. Installation/secrets/outbound network delivery requires a separate least-authority/SSRF/audit boundary.

## 12. Security and privacy requirements

- Treat all external responses, model output, stored JSON, environment values, connector results, calendar/plugin payloads, and decoded database rows as untrusted until validated.
- Parameterize SQL; never interpolate untrusted values into SQL structure.
- Use least-privilege GitHub/runtime/database permissions.
- Bound subprocess/network/file operations by time and size when exhaustion is plausible.
- Retained CI/model/public artifacts exclude credentials, browser cookies, raw prompts/responses, hidden reasoning, and unbounded tenant content.
- `SECURITY.md` governs reporting; `docs/THREAT_MODEL.md` governs architecture threats.
- Sensitive access uses purpose/resource/actor/lifetime control and auditable evidence rather than blanket masking.
- Export/delete lifecycle is **Partial** / issue #55 until concrete contributors, durable orchestration/reconciliation, recent-auth, retention/legal-hold, protected delivery, and audit evidence are complete.

See `docs/PRIVACY_DATA_LIFECYCLE.md`.

## 13. Web/PWA/accessibility/localization

- Core journeys support keyboard navigation and visible focus.
- Essential status is not color-only.
- Reduced-motion preferences are respected where relevant.
- Korean/English catalogs remain structurally aligned.
- PWA/local drafts never imply successful durable synchronization until server acceptance is proven.
- Stale asynchronous requests cannot replace the latest owned UI state after query/navigation/unmount changes.

## 14. Observability and diagnostics

- Services expose bounded health/readiness appropriate to their actual responsibility.
- Metrics are an operator surface and production ingress restricts them.
- Correlation IDs propagate where implemented.
- Logs are structured, bounded, credential-free, and avoid unnecessary personal text.
- Errors distinguish validation/authentication/authorization/conflict/rate-limit/dependency/unexpected classes without leaking dependency internals.
- Numeric SLA/SLO objectives exist only in measured/operator-specific scoped documents.

## 15. Backup, migration, rollback, and deployment

- Schema changes include migration compatibility plus rollback or forward-fix evidence appropriate to risk.
- Logical backup produces checksum/integrity evidence and restore rejects corruption/unsafe non-empty targets.
- Logical dumps do not imply PITR; WAL/archive/replication are operator work until explicitly implemented.
- Workload rollback claims cover only state explicitly captured/verified by the deployment workflow; completed DB migrations/external infrastructure are not represented as automatically reversible.
- Compose provides local/self-hosted composition.
- Kubernetes artifacts are a provider-neutral hardened reference and deliberately do not provision cluster, DB, NATS, ingress/TLS/DNS, registry, or secret manager.

See `docs/OPERABILITY.md` and `docs/RELEASE_AND_MIGRATION.md`.

## 16. Test requirements

- Unit tests cover deterministic domain invariants and malformed inputs.
- PostgreSQL tests cover durability, tenancy, transactions, replay, concurrency, expiry, and recovery.
- HTTP integration covers actual authority/problem boundaries.
- Browser E2E covers core journey, localization, accessibility, and PWA behavior where applicable.
- Security regressions cover AppGuardrail/GHAS classes and model/provider/trust boundaries.
- Backup/restore/deployment references have executable contract tests.
- Deterministic gates are separate from bounded live-provider evidence.
- Owned packages declaring exact gates maintain meaningful 100% statement/branch/function/line coverage.
- Documentation consistency validates canonical files/links/ADRs/status and code-current authority claims.

See `docs/TEST_STRATEGY.md`.

## 17. Release requirements

A stable release requires one exact protected integrated head with applicable:

- required CI/security/dependency/review gates;
- exact owned-code coverage;
- package/container build/smoke evidence;
- migration/recovery/backup evidence;
- accessibility/localization/browser evidence;
- SBOM/provenance/reproducibility evidence required by policy;
- no unresolved valid security/review finding;
- release notes/changelog matching the artifact.

Do not bump product version merely because one PR, documentation set, or intermediate product slice is complete.
