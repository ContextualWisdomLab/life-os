# LifeOS API and Event Contract Registry

**Baseline:** protected `main` at `5c87a7ec3568a4ce47b25cad843f1bc5be91b294`

## 1. Purpose

This document is the canonical registry of **contract ownership and versioning**, not a hand-maintained duplicate of every route schema. Exact request/response shapes remain authoritative in the owning service source, exported package types, tests, and generated schema where present.

A route or event mentioned here is not permission for one service to access another service's database.

## 2. Shared contract primitives

`packages/contracts/src/index.ts` currently defines the shared TypeScript primitives used across bounded contexts:

- `WorkspaceRole`
- `RequestContext`
- `ProblemDetails`
- versioned `DomainEvent<TPayload>`
- `planning.task.completed.v1` / `TaskCompletedEvent`

The shared event envelope carries an opaque event ID, explicit type/version, occurrence time, actor/workspace/correlation identity, optional causation identity, and bounded typed payload.

### Contract rules

- Internal IDs use UUIDv4 under the repository-wide invariant.
- Workspace/actor identifiers carried in a request/event do not become authority unless the receiving boundary verifies the authenticated/signed context required by that contract.
- Public problems are credential-free and bounded.
- Breaking semantic changes require a new route/event/schema version; changing TypeScript shape without versioning does not constitute a safe protocol migration.
- Unknown event/operation versions fail closed rather than silently falling back to a semantically different contract.

## 3. HTTP bounded-context registry

| Boundary | Owner | Current responsibility | Status |
| --- | --- | --- | --- |
| Browser session / OAuth start/callback/introspection | Identity service | Google/GitHub external identity, revocable browser session, workspace/actor authority | Implemented on protected main |
| Planning goals/projects/tasks/search | Planning service | durable planning source of truth and search | Implemented on protected main |
| Habit definition/completion | Habit service | recurring habits and immutable/replay-safe completion lifecycle | Implemented on protected main |
| Daily/weekly review | Review service | review snapshots/projections/observations | Implemented on protected main |
| Today composition / browser APIs | Gateway/Web BFF | authenticated composition; no durable cross-domain database authority | Implemented on protected main; full durable Today aggregate concurrency is Partial |
| Calendar synchronization | Calendar integration service | CalDAV/Google provider adaptation with duplicate/conflict protection | Implemented on protected main |
| Calendar connection/credential lifecycle | Calendar integration service target boundary | encrypted per-user credential lifecycle/provider selection | Planned / issue #129 |
| Reminder scheduling/delivery | Notification service | durable occurrences, claims, outcomes, inbox delivery | Implemented on protected main |
| AI proposal/evidence/decision | AI proposal service | inert proposal generation/persistence/decision audit | Implemented on protected main |
| Purpose-bound sensitive access | Privacy access service | access decisions/grants/events | Implemented on protected main |
| Plugin contract discovery/validation/event preparation | Integration service + plugin SDK | versioned plugin boundary without direct DB access | Implemented on protected main |
| Generic plugin install/secrets/outbound delivery | Future integration boundary | least-privilege install/network/secret/runtime authority | Planned |
| Tenant export/erasure orchestration | Identity-owned data-rights core + future contributors | deterministic export and fail-closed erasure coordination | Partial / issue #55 |

## 4. Authentication and private context

Browser-facing routes authenticate through the identity/web boundary. Downstream services do not trust arbitrary client-supplied `workspace_id`/`actor_id` fields as authorization.

For signed internal context contracts:

- bind the exact workspace and actor;
- bind the exact HTTP method and path where required;
- include bounded issuance/lifetime/key identity;
- verify only explicitly active/overlap keys;
- reject retired/unknown/malformed contexts;
- never forward browser cookies, OAuth access tokens, model credentials, or unrelated service secrets as generic context.

## 5. Mutation contract

A state-changing HTTP contract defines applicable:

- ownership/role/purpose requirement;
- request size and string/collection bounds;
- UUID/version/schema validation;
- idempotency/replay key;
- stale-write precondition (`revision`, digest, ETag, or equivalent);
- transactional persistence boundary;
- public conflict/problem classification;
- immutable audit/outcome evidence;
- recovery/retry behavior.

A caller receiving HTTP success must not infer a side effect that the owning service contract does not explicitly guarantee.

## 6. Event contract registry

### `planning.task.completed.v1`

**Owner:** Planning service.  
**Envelope:** shared `DomainEvent<TaskCompletedPayload>`.  
**Meaning:** one planning task completion occurred at the supplied instant for the authenticated/authorized workspace/actor context.

Consumers may project or trigger bounded follow-up behavior. They may not use the event as permission to update planning tables.

### Additional event families

Notification/review/integration features may use service-specific events or durable polling according to current source. Add any cross-service event to this registry when it becomes a supported product contract. Do not infer a durable event from an internal TypeScript callback or test fixture.

## 7. Provider adapter contracts

### Identity providers

Provider account identifiers are external metadata. Callback/state/error payloads are untrusted and provider-specific. The identity service converts them to LifeOS authority only after verification.

### Calendar providers

The provider port exposes only reviewed operations. Current CalDAV/Google synchronization preserves deterministic resource identity and strong preconditions where supported. DELETE/MOVE/COPY are not implicitly authorized because the provider supports them.

### Model/contextual-orchestrator provider

The model boundary receives bounded prompt/context and returns untrusted structured output. It has no implicit product mutation authority. Live-provider failures are classified/sanitized instead of transformed into fabricated proposals or quality metrics.

### Plugin adapters

Plugin manifests/events are versioned, bounded and tenant scoped. Generic outbound network access or secret storage is not part of the existing plugin contract.

## 8. Contract evolution

A breaking contract change requires:

1. identify owning bounded context;
2. document old/new schema and compatibility window;
3. add consumer/provider contract tests;
4. add migration/replay/concurrency behavior if stateful;
5. update shared package types only after the protocol decision is explicit;
6. preserve old version during the reviewed compatibility window or fail explicitly;
7. update PRD/TRD/architecture/UML/data/threat/operability/traceability where the change crosses those boundaries;
8. update `CHANGELOG.md` for buyer/operator-visible behavior.

Do not rely on simultaneous deployment of every service unless the release explicitly proves that coupling.

## 9. Contract evidence hierarchy

For an exact current contract, inspect in order:

1. owning service route/controller/domain/persistence source on protected main;
2. exported shared/plugin SDK types;
3. owning integration/contract tests;
4. migrations and provider adapters;
5. scoped feature specification/runbook;
6. this registry.

This registry is intentionally concise so it cannot silently drift into a second implementation specification.
