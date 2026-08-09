# LifeOS API and Event Contract Registry

**Status:** Accepted architecture  
**Baseline:** protected `main` at `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`

This registry records contract ownership and maturity. Exact request/response/event shapes remain authoritative in owning source packages, controllers, schemas and tests.

## 1. Contract rules

- Breaking semantics require an explicit version change or reviewed migration path.
- Browser-selected actor/workspace identifiers are never tenant authority.
- Public/internal bodies are bounded before unnecessary retention.
- Replayable mutations use idempotency identity where duplicate effects are plausible.
- Stale-write-sensitive mutations use explicit revision/digest/ETag/precondition semantics.
- Errors remain bounded and credential-free.
- Provider responses, plugin manifests/events and model output are untrusted.
- Events do not grant direct database authority over their producer.

## 2. HTTP ownership registry

| Boundary | Owner | Status | Notes |
| --- | --- | --- | --- |
| Login/OAuth/session | Identity service | Implemented on protected main | Google/GitHub provider flows and revocable sessions. |
| Session introspection / trusted identity context | Identity service | Implemented on protected main | Used by authenticated web/gateway composition. |
| Planning goals/projects/tasks/search | Planning service | Implemented on protected main | Planning service is sole mutation authority. |
| Durable Today aggregate | Planning service | Implemented on active PR | PR #127; issue #121. |
| Habit definition/completion | Habit service | Implemented on protected main | Tenant-scoped replay-safe completion. |
| Guided review | Review service | Implemented on protected main | Projection/evidence boundary. |
| Reminder/inbox operations | Notification service | Implemented on protected main | Durable occurrence/claim/outcome model. |
| Calendar synchronization | Calendar integration service | Implemented on protected main | CalDAV/Google conflict-safe provider adapters. |
| Calendar trusted workspace context | Calendar integration service | Implemented on active PR | PR #139; removes legacy client-selected workspace authority. |
| Hosted per-user calendar credential lifecycle | Calendar integration service | Partial | Issue #129. |
| AI proposal generation/evidence/decision | AI proposal service | Implemented on protected main | Inert proposal and auditable decision boundary. |
| Purpose-bound sensitive-data access | Privacy service | Implemented on protected main | Actor/workspace/resource/purpose/lifetime authorization. |
| Data-rights recent-authenticated request ledger | Identity service | Implemented on protected main | #134-#138; durable request/receipt foundation. |
| Complete cross-domain export/erasure orchestration | Identity coordinator + contributors | Partial | Issue #55. |
| Plugin contract discovery/validation/preparation | Plugin integration service | Implemented on protected main | No implicit runtime/install authority. |
| Plugin install/secret/delivery runtime | Plugin integration service | Planned | Issue #130. |

## 3. Selected mutation semantics

### Today aggregate

**Status:** Implemented on active PR

- complete aggregate scoped to authenticated workspace and local date;
- explicit create/update preconditions;
- opaque revision token;
- exact idempotency replay returns the original outcome;
- conflicting idempotency reuse fails closed;
- stale revision returns a bounded conflict containing only current opaque revision evidence;
- browser local draft is uploaded only after explicit user action.

### Data-rights request ledger

**Status:** Implemented on protected main

- request ID and idempotency key are UUIDv4;
- request kind is bounded to supported rights operations;
- request/receipt evidence uses bounded digests/status/timestamps rather than export payload retention;
- request-ID or idempotency collision maps to stable domain conflict;
- terminal receipt evidence is immutable;
- completed evidence can survive source workspace/user erasure under its bounded retention purpose.

### Calendar synchronization

**Status:** Implemented on protected main

- create/update operations use deterministic provider identity and strong preconditions where supported;
- provider responses are bounded/untrusted;
- delete/move/copy authority is not implied by sync support.

### Calendar trusted context

**Status:** Implemented on active PR

PR #139 requires a short-lived HMAC-bound UUIDv4 workspace context and rejects unsigned/forged/stale/future/malformed input or missing verifier configuration. Full credential lifecycle remains separate.

## 4. Event registry

Event names and versions in source packages remain authoritative. Repository-wide rules are:

| Event class | Producer | Typical consumer | Status |
| --- | --- | --- | --- |
| Planning domain events | Planning | Notification/review/integration projections | Implemented on protected main |
| Habit domain events | Habit | Notification/review projections | Implemented on protected main |
| Review projection events | Review | Notification/analytics surfaces as implemented | Implemented on protected main |
| Plugin CloudEvents-compatible envelope | Plugin SDK/integration service | External/plugin delivery preparation | Implemented on protected main |
| Plugin outbound runtime delivery | Plugin integration runtime | Authorized external origin | Planned |

Every event includes explicit type/version and bounded tenant/correlation identity. Consumers are idempotent where replay/at-least-once delivery applies.

## 5. Error classes

Public boundaries should distinguish, where relevant:

- validation error;
- unauthenticated;
- unauthorized/purpose denied;
- not found without cross-tenant disclosure;
- conflict/stale write/idempotency reuse;
- rate limit/backpressure;
- dependency unavailable;
- internal unexpected failure.

Errors must not expose SQL, stack traces, credentials, provider response bodies, model raw text or private infrastructure URLs.

## 6. Contract change procedure

1. Add a failing contract/integration test for the proposed behavior.
2. Update owning source/schema and consumer compatibility.
3. Verify exact-head source and merge-tree compatibility where both are relevant.
4. Update this registry, PRD/TRD/UML/data model and ADR when authority or semantics materially change.
5. Mark active PR behavior separately until protected-main integration.
6. Update `CHANGELOG.md` only for buyer/operator-visible behavior.