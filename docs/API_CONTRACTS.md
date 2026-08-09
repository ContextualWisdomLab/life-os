# LifeOS API and Event Contracts

**Status:** Implemented on active PR

This file indexes stable repository-level API/event invariants. Concrete route schemas remain owned by the implementing service and tests.

## Common rules

- Internal IDs are opaque UUIDv4.
- Ownership is derived from authenticated/signed context, never arbitrary browser headers or request bodies.
- Mutations use idempotency and/or strong preconditions where replay/stale overwrite is plausible.
- Public failures are bounded and credential-free.
- Provider responses and model output are untrusted until schema/boundary validation.
- Cross-service contracts never grant direct database authority.

## Contract registry

| Contract | Owner | Status | Notes |
| --- | --- | --- | --- |
| OAuth login/callback/session | identity-service | Implemented on protected main | Google/GitHub, bounded state/redirect/session lifecycle |
| Planning Goal/Project/Task APIs | planning-service | Implemented on protected main | tenant-derived authority |
| Durable Today aggregate | planning-service | Implemented on protected main | strong ETag/precondition, idempotency, explicit conflict semantics; PR #127 |
| Habit recurrence/completion | habit-service | Implemented on protected main | tenant-scoped replay-safe completion |
| Review projection | review-service | Implemented on protected main | read/projection authority only |
| Calendar sync request | calendar integration | Implemented on protected main | signed trusted workspace context; PR #139 |
| Per-user calendar connection OAuth/credential API | calendar integration | Planned | issue #129 |
| Reminder scheduling/delivery | notification-service | Implemented on protected main | bounded claims/retries/outcomes |
| AI proposal/evidence/decision | AI proposal service | Implemented on protected main | inert proposal, explicit decision |
| Purpose-bound privacy access | privacy-service | Implemented on protected main | actor/resource/purpose/lifetime bound |
| Data-rights request/status | identity-service | Partial | durable receipt and tenant-scoped lookup exist; complete public orchestration under #55 |
| Plugin manifest/event validation | integration-service | Implemented on protected main | versioned SDK/validation |
| Plugin installation/secrets/outbound delivery | integration-service | Planned | issue #130 |

## Event envelope

When asynchronous events are used, the envelope includes a unique opaque event ID, explicit event type/version, validated workspace/actor where applicable, correlation/causation identifiers, occurrence/publication time, and a bounded immutable payload. Consumers must be idempotent under at-least-once delivery.

## Planning completion event

`planning.task.completed.v1` and similar events are evidence notifications, not permission for a consumer to write planning tables.

## Versioning

Breaking route/event/schema semantics require explicit versioning or a reviewed migration contract. Unknown versions fail closed.

## Evidence identity

Verification tooling distinguishes contributor source head, PR-base snapshot, independently resolved live base, synthetic merge candidate, protected main and release artifact identities. Issue #132 tracks broad required-workflow exact-source attribution.