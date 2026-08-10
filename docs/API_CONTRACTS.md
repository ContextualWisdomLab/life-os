# LifeOS API and Event Contracts

**Status:** Implemented on active PR

This registry summarizes repository-level API/event invariants. Concrete route schemas remain owned by the implementing service and tests.

## Common rules

- Internal IDs are opaque UUIDv4.
- Ownership comes from authenticated/signed context, never arbitrary browser fields.
- Replayable/stale-sensitive mutations use idempotency and/or strong preconditions.
- Public failures are bounded and credential-free.
- Provider responses, plugin metadata and model output are untrusted until validated.
- Cross-service contracts never grant direct database authority.
- Verification evidence is valid only for the exact tree actually inspected.

## Contract registry

| Contract | Owner | Status | Notes |
| --- | --- | --- | --- |
| OAuth login/callback/session | identity-service | Implemented on protected main | Google/GitHub, bounded transaction/session lifecycle |
| Planning Goal/Project/Task | planning-service | Implemented on protected main | tenant-derived authority |
| Durable Today aggregate | planning-service | Implemented on protected main | PR #127; strong preconditions/idempotency/conflicts |
| Habit recurrence/completion | habit-service | Implemented on protected main | tenant-scoped replay safety |
| Review projection | review-service | Implemented on protected main | projection/read authority only |
| Calendar sync request | calendar integration | Implemented on protected main | PR #139 signed workspace context |
| Calendar connection registry | calendar integration | Implemented on protected main | PR #150; workspace+user scoped metadata + opaque secret references |
| Atomic calendar connection revocation | calendar integration | Implemented on protected main | PR #153; exact tenant+user scope and revocation replay |
| Signed calendar workspace+user context | calendar integration | Implemented on active PR | PR #155; distinct short-lived `life-os.calendar-user.v1` authority |
| Complete per-user calendar credential lifecycle | calendar integration | Partial | issue #129; OAuth/PKCE, managed secret backend, refresh/provider revoke, discovery/selection remain |
| Reminder scheduling/delivery | notification-service | Implemented on protected main | bounded claims/retries/outcomes |
| AI proposal/evidence/decision | AI proposal service | Implemented on protected main | inert proposal + explicit decision |
| Purpose-bound sensitive access | privacy-service | Implemented on protected main | actor/resource/purpose/lifetime bound |
| Data-rights request ledger/status lookup | identity-service | Implemented on protected main | #138/#144 |
| Authenticated public data-rights status | identity-service | Implemented on protected main | PR #146; no-store bounded projection |
| Tenant export integrity manifest | identity coordinator + contributors | Implemented on protected main | PR #149; section/whole SHA-256 evidence |
| Complete cross-domain export/erasure | identity coordinator + contributors | Partial | issue #55 |
| Plugin manifest/event validation | integration-service | Implemented on protected main | versioned SDK/validation |
| Explicit plugin installation grants | integration-service | Implemented on protected main | PR #151; explicit subset, replay/conflict/revocation |
| Complete plugin secret/outbound delivery runtime | integration-service | Partial | issue #130 |
| Source-head vs merge-tree verification | repository workflows | Implemented on active PR | clean successor PR #154; #147 superseded; ADR 0010 |

## Data-rights status

**Status:** Implemented on protected main

PR #146 derives workspace/user scope from the server session and exposes only request ID, request kind, lifecycle status and bounded timestamps. Malformed request IDs map to bounded 400, invalid sessions to 401, absent/cross-tenant requests to indistinguishable 404, dependency failures to sanitized 503, and responses are non-cacheable. This does not complete issue #55.

## Export integrity

**Status:** Implemented on protected main

PR #149 binds contributor identity, schema version, safe business record count and bounded normalized JSON into deterministic per-section SHA-256 evidence plus an ordered whole-export digest. Locale-independent UTF-16 property ordering is used for digest stability. Digests are integrity evidence, not access control, confidentiality, provenance or digital signatures.

## Calendar connection lifecycle

### Persistence foundation

**Status:** Implemented on protected main

PR #150 persists a LifeOS-owned connection under exact workspace+user scope with bounded provider/account/calendar metadata, normalized scopes, fixed parameterized SQL and opaque secret references. The metadata row is not a credential store.

### Local connection revocation

**Status:** Implemented on protected main

PR #153 adds atomic tenant+user-scoped connection revocation and exact replay behavior. Revoking the LifeOS connection record does not by itself prove provider-side OAuth revocation or secret destruction; those remain issue #129 lifecycle requirements.

### Hosted user authority

**Status:** Implemented on active PR

PR #155 introduces a short-lived HMAC context that binds both workspace and user UUIDv4 identities under a version distinct from workspace-only sync context. It rejects identifier substitution, stale/future/malformed evidence and unusable verifier configuration. Public disconnect/runtime composition is a later #129 slice.

## Plugin installation authority

**Status:** Implemented on protected main

PR #151 treats a validated manifest as requested intent, not granted authority. The host grants an explicit tenant-scoped capability subset, accepts exact replay, rejects conflicting reuse, hides cross-tenant/user existence and preserves revocation evidence. Durable secret persistence and outbound delivery remain incomplete under #130.

## Events

Asynchronous events use an opaque event ID, explicit type/version, validated tenant/actor/correlation/causation context and bounded immutable payload. Consumers are idempotent under replay. Receiving an event never grants producer-database authority.

## Versioning

Breaking route/event/schema semantics require explicit versioning or a reviewed migration contract. Unknown versions fail closed.

## Verification evidence identity

**Status:** Accepted architecture

`source_head_sha`, PR-base snapshot, independently resolved `live_base_tip_sha`, `merge_tree_sha`, `workflow_checkout_sha`, protected-main identity and release-source identity are separate authorities. Synthetic integration success is not exact contributor-source verification.

ADR 0010 is the durable decision. Clean successor PR #154 is `Implemented on active PR`; #147 is superseded. Issue #132 remains open until the correction integrates and residual required-workflow attribution is reconciled.
