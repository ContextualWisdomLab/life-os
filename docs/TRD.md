# LifeOS Technical Requirements Document

**Version:** 1.0-draft  
**Baseline:** protected `main` at `5c87a7ec3568a4ce47b25cad843f1bc5be91b294`

## 1. Purpose

This document defines repository-wide technical requirements for LifeOS. It does not replace service-specific specifications, migrations, OpenAPI/schema source, or operator runbooks. It states the common runtime, authority, data, failure, security, quality, and deployment contracts those artifacts must satisfy.

## 2. Architecture status

LifeOS is a TypeScript-first monorepo containing a Next.js web/PWA, gateway/BFF, and independently bounded domain services. PostgreSQL is the durable system of record for persisted domains. NATS JetStream is available for versioned asynchronous domain events. Optional external providers include Google/GitHub identity, Google Calendar/CalDAV, and model providers through approved AI boundaries.

The following are **Implemented on protected main** or have direct protected-main evidence:

- web/PWA and gateway;
- identity/OAuth/session boundaries;
- planning persistence and search;
- recurring habit persistence/completion;
- guided review;
- calendar provider adapters;
- notification persistence/scheduling;
- AI proposal persistence, decisions, evaluation and optional contextual-orchestrator transport;
- plugin contract discovery/validation/preparation;
- purpose-bound privacy access service;
- PostgreSQL logical backup/restore;
- provider-neutral Kubernetes reference deployment;
- AppGuardrail/security/commercial-readiness gates.

Autonomous OpenCode product-development automation in PR #122 is **Implemented on active PR**, not protected-main behavior at this baseline.

## 3. Technology baseline

| Concern | Requirement |
| --- | --- |
| Web | Next.js + React + TypeScript |
| Gateway/domain services | NestJS/TypeScript-compatible service processes following existing repository patterns |
| Package/workspace | pnpm + Turborepo |
| Durable database | PostgreSQL |
| Event transport | NATS JetStream when asynchronous durability is required |
| Container composition | Docker Compose for local/self-hosted composition |
| Production reference | Kubernetes/Kustomize provider-neutral reference |
| Observability | structured logs, correlation IDs, Prometheus-compatible metrics, existing OpenTelemetry/SLO contracts where implemented |
| AI live provider | approved OpenCode/contextual-orchestrator boundary using `NVIDIA_NIM_API_KEY` where model access is required |

New dependencies require demonstrated product/operational need and must not create a second competing production authority for an existing bounded context.

## 4. Bounded contexts and authority

### 4.1 Web / PWA

The web application owns interaction state and browser-only drafts/caches. It does not own durable domain truth and does not access service databases directly.

### 4.2 Gateway / BFF

The gateway is the public composition boundary for browser/API traffic. It may authenticate/compose/route, but it must not become a hidden shared domain database or generic cross-service mutation bus.

### 4.3 Identity service

Owns user/account identity mappings, sessions, workspace membership/authorization context, and provider identity boundaries. Numeric or provider-native identifiers never become internal primary keys.

### 4.4 Planning service

Owns goals, projects, milestones, tasks, planning search, Today-related durable planning state, and planning mutation rules. Review, AI, notification, or integration services cannot update planning tables directly.

### 4.5 Habit service

Owns habit definitions, recurrence behavior, occurrences/completion evidence, and habit-specific persistence.

### 4.6 Review service

Owns review snapshots/projections/observations. It consumes source evidence and does not become source of truth for planning/habit entities.

### 4.7 Calendar integration service

Owns provider adaptation and synchronization state required by its contract. It cannot infer tenant authority from untrusted client-provided workspace IDs. Per-user credential lifecycle remains incomplete for hosted Google Calendar use unless current source proves otherwise.

### 4.8 Notification service

Owns reminder occurrence/claim/outcome/in-app-delivery persistence, retry/fatigue/quiet-hour rules, and worker recovery.

### 4.9 AI proposal service

Owns proposal-generation boundary, immutable proposal evidence, explicit accept/reject decision history, and deterministic proposal-quality evaluation. It does not own planning mutation authority.

### 4.10 Privacy service

Owns purpose-bound sensitive-data access decisions/grants/events and its persistence contract. It supports explicit authorization/audit evidence without normalizing every sensitive value into an unusable masked form.

### 4.11 Plugin integration service / SDK

Owns plugin contract discovery, manifest validation, event preparation and SDK types. Plugin installation, durable plugin secrets, outbound delivery, and inbound command authority remain separately governed capabilities.

## 5. Data and identity requirements

### TRD-DATA-001 — Service-owned persistence

Each bounded service owns its database schema/migrations and database credentials. Direct cross-service table reads/writes are prohibited. Shared IDs may appear in logical relationships, but cross-service database foreign keys are not required and must not create hidden deployment coupling.

### TRD-DATA-002 — Internal identifiers

Internal durable identifiers are opaque UUIDv4 strings under the current protected-main contract. External numeric/provider identifiers are stored only through an explicit provider mapping.

### TRD-DATA-003 — Database naming

Product-owned database objects use descriptive names containing at least two words in `snake_case` unless an external protocol or existing compatibility contract requires another spelling.

### TRD-DATA-004 — Time

Persist/API timestamps in UTC when they represent instants; retain user timezone as an IANA timezone where local-calendar semantics matter. Notification and recurring-habit logic must not assume a 24-hour local day across daylight-saving transitions.

### TRD-DATA-005 — Immutability and provenance

Audit/decision/completion/outcome evidence that is defined as immutable or append-only must reject in-place update/delete behavior except explicitly reviewed lifecycle transitions. Mutable entities must preserve enough revision/digest/ETag evidence to detect stale mutation where data loss is plausible.

## 6. Authentication and authorization

- Browser sessions use secure server-side-verifiable/revocable session semantics defined by identity-service.
- OAuth callbacks validate provider/state/redirect boundaries and do not expose provider credentials to downstream services.
- Browser-originated workspace/actor headers are not trusted as authority.
- Private service context must be cryptographically bound to the intended method/path/actor/workspace where the existing service contract requires it.
- Sensitive operations are authorized by purpose/resource/tenant, not merely by authentication presence.
- Third-party integration credentials are distinct from login identities and require their own lifecycle/rotation/revocation boundary.

## 7. Synchronous API requirements

1. Public and internal HTTP inputs are bounded before untrusted bodies are fully retained where practical.
2. Request ownership is derived from authenticated context.
3. State-changing operations support idempotency keys or equivalent replay protection when duplicate submission is realistic.
4. Stale mutation protection uses an explicit version/digest/ETag/precondition where silent overwrite is unacceptable.
5. Public errors are credential-free, bounded, and stable enough for clients to classify.
6. Internal stack traces and dependency response bodies do not become public error details.
7. Redirects and upstream origins are explicitly controlled for security-sensitive provider/model transport.
8. API breakage requires explicit version/schema migration rather than silent semantic drift.

## 8. Event requirements

When NATS/domain events are used:

- event identifiers are opaque and unique;
- payload schema/version is explicit;
- actor/workspace/correlation/causation context is bounded and validated;
- payloads are immutable after publication;
- consumers are idempotent under at-least-once delivery;
- publication uses an outbox/equivalent reliability boundary when database commit and event publication must be atomic in effect;
- no consumer becomes authorized to mutate another bounded context merely because it can see an event.

## 9. Concurrency and idempotency

### Planning and browser state

Durable planning writes must reject or reconcile stale state rather than silently overwrite newer work. Browser-local drafts must remain visibly distinct from durable state until explicit synchronization/migration succeeds.

### Habit completion

Completion commands use idempotency evidence and concurrency-safe persistence so repeated/concurrent submissions resolve to one accepted completion lifecycle.

### Notifications

Worker claims are fenced/expiring, delivery identifiers are replay-safe, and duplicate delivery or immutable outcome mutation is rejected.

### AI decisions

Accept/reject decisions bind to the exact proposal/revision/digest, actor, workspace and idempotency evidence. A stale proposal revision must not be silently accepted as the current proposal.

### Privacy grants

Single-use or time-bounded grants fail closed at expiry/consumption boundaries and cannot be repurposed for another actor/purpose/resource.

## 10. AI and model-provider requirements

### Deterministic authority

- Model output is untrusted structured data.
- Deterministic validators and product authorization remain authoritative.
- AI cannot silently mutate user-owned planning data.
- Proposal evaluation includes validity, operation conformance, grounding, utility, leakage/prompt-injection resistance as implemented.

### Live-provider separation

- Live provider availability is not a deterministic PR merge requirement unless a separately reviewed release gate explicitly requires it.
- Provider credential absence/outage produces sanitized unavailable evidence rather than fabricated scores.
- `NVIDIA_NIM_API_KEY` is scoped to the model boundary and not copied into retained artifacts.
- `COPILOT_GITHUB_TOKEN` is not a development-model credential for LifeOS autonomous workflows.

### Orchestration

A strong single-model route is the mandatory baseline. Deeper orchestration must expose workflow stage, reasoning effort, decomposition, recursion, roles and access topology and must be justified by measured quality/control evidence.

## 11. External integration requirements

### Identity providers

Google/GitHub OAuth provider registration, redirect policy and production secrets are operator-owned deployment inputs. Provider outages degrade login/link operations, not already-authenticated unrelated domain reads/writes where sessions remain valid.

### Calendar providers

- CalDAV/Google adapters use deterministic identifiers/preconditions where available.
- Provider responses and ETags are untrusted and validated.
- The service exposes no destructive operation not included in the reviewed provider contract.
- Per-user credential persistence/refresh/revocation must be implemented and tested before a hosted multi-user deployment claims unattended Google Calendar synchronization.

### Plugins

- Manifests/events are bounded and validated.
- No direct DB access.
- Installation/secrets/outbound networking require separate least-privilege/SSRF/audit design.

## 12. Security requirements

- Treat every external response, model output, stored JSON, environment value, connector result and plugin/calendar payload as untrusted until validated.
- Parameterize SQL; never interpolate untrusted values into SQL structure.
- Use least-privilege GitHub/workflow/runtime/database permissions.
- Bound subprocess/network/file operations with timeouts and size limits when blocking or resource exhaustion is possible.
- Do not retain credentials, browser cookies, raw prompts/responses, hidden reasoning, or unbounded tenant content in CI/model artifacts.
- Keep vulnerability reporting policy in `SECURITY.md`; maintain architectural threat analysis in `docs/THREAT_MODEL.md`.
- Supply-chain workflows pin external actions/artifacts immutably where repository policy requires it and produce SBOM/provenance at release readiness.

## 13. Privacy and data-rights requirements

- Sensitive data access must be purpose/resource/actor scoped with durable audit evidence where privileged access occurs.
- Privacy controls must preserve product/scientific utility instead of using indiscriminate masking as the only control.
- Export/delete operations require explicit user authority, tenant scope, idempotency/retry semantics, auditability, and documented partial-failure/recovery behavior before being called complete.
- Public logs/metrics/errors do not expose personal goal/task/health/relationship content.
- Self-hosting operators remain responsible for their own legal basis, retention, subprocessors, notices and deployment controls.

## 14. Web/PWA requirements

- Core workflows support keyboard navigation and visible focus.
- No essential status is conveyed solely by color.
- Reduced-motion preferences are respected where motion exists.
- Korean and English catalogs remain structurally aligned.
- PWA/local drafts do not imply durable synchronization until server acceptance is proven.
- Stale asynchronous requests must not replace the latest visible state after query/navigation/unmount changes.

## 15. Observability and diagnostics

- Every service exposes bounded health/readiness behavior appropriate to its runtime responsibility.
- Metrics endpoints are an operator surface and production ingress restricts them appropriately.
- Correlation identifiers propagate across request/event boundaries where implemented.
- Logs are structured, bounded and credential-free.
- Error classification distinguishes validation/authentication/authorization/conflict/rate-limit/dependency/unexpected failures without leaking dependency internals.
- SLO/runbook numbers exist only where measured/committed by an operator-specific document; architecture prose does not invent SLA values.

## 16. Backup, migration and recovery

- Schema changes are forward-reviewed with migration/rollback or forward-fix evidence appropriate to the change.
- Logical backup produces integrity/checksum evidence and restore rejects corrupted archives or unsafe non-empty targets under the current contract.
- Logical backup does not imply PITR; WAL/archive/replication are operator work until explicitly implemented.
- Production deployment captures enough prior workload state to verify rollback/deletion behavior for the workload resources it claims to recover.
- Completed database migrations are not automatically represented as reversible unless an explicit reverse/compensating path exists.

## 17. Deployment profiles

### Local / development Compose — Implemented on protected main

Composes LifeOS services, PostgreSQL/NATS dependencies and local development boundaries. It is not a promise that every production external dependency is bundled.

### Self-hosted portable deployment — Accepted/partially implemented

Operators can supply independent PostgreSQL/NATS/secrets/identity/calendar/model infrastructure. Service contracts remain portable.

### Kubernetes production reference — Implemented on protected main as reference

Kustomize/reference workflow supplies hardened workload/network/deployment semantics but deliberately does not provision cluster, database, NATS, ingress/TLS/DNS, image registry pipeline or secret manager.

## 18. Test requirements

- Unit tests cover domain invariants and malformed inputs.
- PostgreSQL integration tests cover durability, transactions, tenant isolation, idempotency and recovery.
- HTTP integration tests cover actual auth/ownership/error boundaries.
- Browser E2E covers primary user journeys, localization and accessibility.
- Security regressions cover known AppGuardrail/GHAS classes and prompt/provider boundaries.
- Backup/restore/deployment references receive real executable contract tests.
- Deterministic product gates are separated from bounded live-provider evidence.
- Owned production code that declares exact 100% gates must satisfy statement/branch/function/line coverage with meaningful assertions.
- Documentation consistency should verify the canonical graph, ADR index/status, links, Mermaid/code fences and code-current service/state names.

See `docs/TEST_STRATEGY.md`.

## 19. Release requirements

A stable release requires one exact integrated protected head with:

- required CI and security checks;
- exact coverage gates;
- package/container build evidence;
- SBOM/provenance according to repository release policy;
- migration/recovery verification;
- backup/restore evidence where applicable;
- supported-browser/accessibility/localization evidence;
- required independent review/branch protection;
- no valid unresolved security/review findings;
- release notes/changelog that match the artifact.

Do not bump product version merely because documentation or one feature PR is complete.
