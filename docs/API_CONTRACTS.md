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
- Verification evidence is valid only for the exact tree a job inspected; source-head and integration-merge evidence remain separate.

## Contract registry

| Contract | Owner | Status | Notes |
| --- | --- | --- | --- |
| OAuth login/callback/session | identity-service | Implemented on protected main | Google/GitHub, bounded state/redirect/session lifecycle |
| Planning Goal/Project/Task APIs | planning-service | Implemented on protected main | tenant-derived authority |
| Durable Today aggregate | planning-service | Implemented on protected main | strong ETag/precondition, idempotency, explicit conflict semantics; PR #127 |
| Habit recurrence/completion | habit-service | Implemented on protected main | tenant-scoped replay-safe completion |
| Review projection | review-service | Implemented on protected main | read/projection authority only |
| Calendar sync request | calendar integration | Implemented on protected main | signed trusted workspace context; PR #139 |
| Per-user calendar connection OAuth/credential API | calendar integration | Partial | issue #129; provider adapter exists but hosted encrypted credential lifecycle is incomplete |
| Reminder scheduling/delivery | notification-service | Implemented on protected main | bounded claims/retries/outcomes |
| AI proposal/evidence/decision | AI proposal service | Implemented on protected main | inert proposal, explicit decision |
| Purpose-bound privacy access | privacy-service | Implemented on protected main | actor/resource/purpose/lifetime bound |
| Data-rights durable request ledger/status lookup | identity-service | Implemented on protected main | #138/#144; actor+workspace scoped persistence primitive, immutable bounded receipt evidence |
| Authenticated public data-rights request status resource | identity-service | Implemented on active PR | PR #146; session-derived scope, `GET /v1/data-rights/requests/:requestId`, no-store and bounded 400/401/404/503 semantics |
| Complete cross-domain data export/erasure lifecycle | identity coordinator + domain contributors | Partial | issue #55; contributor/reconciliation/delivery/retention lifecycle remains incomplete |
| Plugin manifest/event validation | integration-service | Implemented on protected main | versioned SDK/validation |
| Plugin installation/secrets/outbound delivery | integration-service | Planned | issue #130 |
| Exact source-head and merge-tree verification evidence | repository workflows | Implemented on active PR | PR #147 advances issue #132; ADR 0010 defines distinct evidence identities |

## Data-rights request status resource

**Status:** Implemented on active PR

PR #146 adds a bounded authenticated projection over the protected-main request ledger. The route derives workspace and requesting-user scope from the validated server session and never accepts those authority fields from the browser.

The successful response contains only the public lifecycle projection: schema version, request ID, request kind, lifecycle state, requested instant and optional completion instant. It does not expose workspace/user IDs, idempotency keys, request digests or receipt digests.

Expected failure semantics are:

- malformed request identifier: bounded 400;
- invalid/expired session: bounded 401;
- absent or cross-tenant request: indistinguishable bounded 404;
- unexpected persistence/dependency failure: sanitized 503;
- every response path is non-cacheable where the controller contract requires it.

This bounded status endpoint is not equivalent to complete export/erasure orchestration under issue #55.

## Event envelope

When asynchronous events are used, the envelope includes a unique opaque event ID, explicit event type/version, validated workspace/actor where applicable, correlation/causation identifiers, occurrence/publication time, and a bounded immutable payload. Consumers must be idempotent under at-least-once delivery.

## Planning completion event

`planning.task.completed.v1` and similar events are evidence notifications, not permission for a consumer to write planning tables.

## Versioning

Breaking route/event/schema semantics require explicit versioning or a reviewed migration contract. Unknown versions fail closed.

## Evidence identity

**Status:** Accepted architecture

Verification tooling distinguishes `source_head_sha`, `pr_base_snapshot_sha`, independently resolved `live_base_tip_sha`, `merge_tree_sha`, `workflow_checkout_sha`, protected-main identity and release-source identity. A pull-request base snapshot is not silently treated as the current base ref, and a synthetic merge result is not exact contributor-source verification.

ADR 0010 is the durable decision. PR #147 is `Implemented on active PR` for the current bounded workflow correction while issue #132 remains open until protected-main integration and any residual required-workflow attribution is reconciled.
