# LifeOS API, Event, and Schema Contracts

**Status:** Implemented on active PR

This registry summarizes repository-level contract invariants. Concrete route, event, and migration schemas remain owned by implementing services and tests.

## Common rules

- Internal/public product IDs are opaque UUIDv4.
- Ownership comes from authenticated/signed context, never arbitrary browser fields.
- Signed service context binds version, exact actor/workspace, method, path, issuance, and one-time evidence where replay matters.
- Replayable or stale-sensitive mutations use idempotency, fencing, and/or strong preconditions.
- Public failures are bounded, non-reflective, and credential-free.
- Provider responses, stored JSON, plugin metadata, and model output remain untrusted until validated.
- Cross-service contracts never grant direct database authority.
- Unknown versions, malformed evidence, corrupt rows, and unavailable authority fail closed.
- Verification evidence is valid only for the exact tree inspected.

## Contract registry

| Contract | Owner | Status | Notes |
| --- | --- | --- | --- |
| OAuth login/callback/session | Identity | Implemented on protected main | Google/GitHub, bounded state/redirect/session/auth-age lifecycle |
| Planning Goal/Project/Task | Planning | Implemented on protected main | signed/request-bound workspace authority through PR #168 and PR #188 |
| Durable Today aggregate | Planning | Implemented on protected main | PR #127; preconditions/idempotency/conflicts |
| Authenticated Today composition | Gateway + Planning + Habit | Implemented on protected main | PR #186 and PR #187; Issue #163 completed |
| Habit recurrence/completion | Habit | Implemented on protected main | signed workspace authority through PR #173 |
| Review completion/projection | Review | Implemented on protected main | request-bound signed authority through PR #185 |
| Integration event context | Integration | Implemented on protected main | exact request binding through PR #190 |
| Calendar sync request | Calendar Integration | Implemented on protected main | PR #139 signed workspace context |
| Calendar connection metadata | Calendar Integration | Implemented on protected main | PR #150 workspace+user scope, opaque secret references |
| Calendar local revocation | Calendar Integration | Implemented on protected main | PR #153 and authenticated disconnect PR #157 |
| Calendar connection read | Calendar Integration | Implemented on protected main | exact lookup PR #176 and authenticated read PR #189 |
| Calendar credential materialization | Calendar Integration | Implemented on protected main | PR #193; validated handles only |
| Calendar connection creation | Calendar Integration | Implemented on protected main | PR #197; authenticated secret-first persistence/compensation |
| Calendar create-evidence compensation hardening | Calendar Integration | Implemented on protected main | PR #201 |
| Complete hosted calendar credential lifecycle | Calendar Integration | Partial | issue #129 |
| Reminder scheduling/delivery | Notification | Implemented on protected main | bounded claims/retries/outcomes |
| AI proposal/evidence/decision | AI Proposal | Implemented on protected main | inert proposal + explicit decision |
| Purpose-bound sensitive access | Privacy | Implemented on protected main | actor/workspace/resource/purpose/lifetime bound |
| Data-rights request ledger/status | Identity | Implemented on protected main | durable request/receipt and bounded non-cacheable projection |
| Tenant export integrity manifest | Identity + contributors | Implemented on protected main | deterministic sections/whole digest |
| Contributor lifecycle v1 | Contracts | Implemented on protected main | PR #159 |
| Planning data-rights contributor | Planning | Implemented on protected main | PR #179 and authenticated transport PR #194 |
| Habit data-rights contributor | Habit | Implemented on protected main | PR #184 and authenticated transport PR #192 |
| Review data-rights contributor | Review | Implemented on protected main | PR #195 |
| Notification data-rights contributor | Notification | Implemented on active PR | PR #198 |
| AI data-rights contributor | AI Proposal | Implemented on active PR | PR #199 |
| Complete cross-domain export/erasure | Identity + every owner | Partial | issue #55 |
| Plugin manifest/event validation | Integration | Implemented on protected main | versioned SDK/validation |
| Plugin installation grants | Integration | Implemented on protected main | PR #151 |
| Durable plugin installation | Integration | Implemented on protected main | PR #169 and exact evidence PR #175 |
| Plugin credential binding | Integration | Implemented on protected main | PR #172; opaque secret reference only |
| Plugin operator request authority | Integration | Implemented on protected main | PR #191 one-time request/replay evidence |
| Plugin operator HTTP composition | Integration | Implemented on protected main | PR #196 fail-closed composition |
| Plugin delivery-origin grant authority | Integration | Implemented on active PR | PR #205; host-owned exact HTTPS origin grant only, with no outbound HTTP or durable grant adapter claim |
| Complete plugin secret/outbound runtime | Integration | Partial | issue #130 |
| Source/live-base/integration verification | Repository workflows | Implemented on protected main | PR #154; residual central taxonomy issue #132 |
| Exact pinned OpenCode bootstrap allowlist | Repository automation | Implemented on protected main | PR #200 |
| Actions workflow-registry orphan detector | Repository automation | Implemented on active PR | PR #204; read-only exact-tree/registry evidence and no workflow-mutation authority |

## Data-rights contributor v1

**Status:** Partial

PR #159 protects the versioned operation set:

- `export` returns bounded deterministic service-owned data, schema version, safe record count, and contributor digest evidence;
- `erase_preflight` reports explicit blockers without deleting;
- `erase` binds exact request/workspace/actor/idempotency authority and returns replay-safe owner receipt evidence;
- `verify_erased` proves the owner no longer retains scoped live records or fails closed.

Planning, Habit, and Review are protected participants. Notification and AI are active-PR participants. The contract does not imply every owner participates or that whole-product reconciliation/delivery is complete.

## Calendar connection lifecycle

### Authority

**Status:** Implemented on protected main

`life-os.calendar-user.v1` binds exact workspace and requesting-user UUIDv4 identities under short-lived HMAC evidence distinct from workspace-only synchronization authority. Stale, future, malformed, substituted, or unconfigured evidence fails closed.

### Read, disconnect, materialize, create

**Status:** Implemented on protected main

- PR #157 exposes authenticated local disconnect without reading provider secret handles.
- PR #176 prevents alternate/corrupt persistence adapters from returning a different connection/workspace/user record.
- PR #189 exposes only bounded credential-free active connection state.
- PR #193 materializes plaintext credential data only inside a validated secret-store port boundary.
- PR #197 writes secret material first, persists only opaque handles, validates returned durable authority, and compensates reviewed failure paths.

PR #201 protects reverse-order compensation of all newly materialized handles when returned durable create evidence mismatches exact identity/handles. OAuth/PKCE, concrete KMS, refresh, provider-side cleanup, discovery/selection, and scoped synchronization remain **Partial** under #129.

## Plugin installation, credentials, and operator composition

### Installation and credential binding

**Status:** Implemented on protected main

PR #151 treats a manifest as requested intent. PR #169 persists exact bounded installation authority. PR #172 materializes credentials only through `PluginSecretStore` and persists only an opaque reference. PR #175 rejects mismatched returned installation identity.

Exact replay cannot rematerialize or overwrite an existing secret. Conflicting durable winners trigger compensation. Revocation ends durable authority before external cleanup and never restores authority during retry.

### Operator requests

**Status:** Implemented on protected main

PR #191 binds installation/workspace/actor, exact method/path, freshness, and one-time evidence to an atomic replay store. PR #196 composes this authority behind a fail-closed HTTP boundary and maps malformed JSON, stale/replayed evidence, absent dependencies, and invalid durable evidence to bounded credential-free problems.

No operator route grants arbitrary SQL, filesystem, subprocess, tool, or network authority. Outbound delivery remains **Partial** under #130.

### Delivery-origin authority

**Status:** Implemented on active PR

PR #205 adds a host-owned authority record for one exact normalized HTTPS origin scoped to opaque UUIDv4 grant, installation, workspace, and granting-user identities. A plugin manifest still expresses intent only and cannot self-authorize a destination. This active slice performs no outbound HTTP and does not yet provide DNS/IP rebinding resistance, connect-time address enforcement, redirect/proxy policy, durable PostgreSQL grant storage, delivery outcomes, retry/dead-letter handling, or operator recovery. Those remain **Partial** under #130.

## Events

Asynchronous events use opaque event IDs, explicit type/version, validated workspace/actor/correlation/causation context, bounded immutable payloads, and idempotent consumers. PR #190 binds protected integration event authority to the exact request. Receiving an event never grants producer-database authority.

## Versioning and compatibility

Breaking route/event/schema semantics require explicit versioning or a reviewed migration contract. Additive optional fields remain bounded and default-safe. Unknown versions fail closed. Migration rollback never fabricates restored external secret/provider state.

## Verification evidence identity

**Status:** Implemented on active PR

`source_head_sha`, `pr_base_snapshot_sha`, `live_base_tip_sha`, integration/synthetic tree identity, `workflow_checkout_sha`, `protected_main_sha`, and `release_source_sha` are separate authorities. PR #154 protects source and live-base compatibility separation. Issue #132 remains **Partial** for central reusable scanner attribution; a synthetic merge scan cannot be called exact-source evidence.

PR #204 is an active, read-only extension that compares one exact protected-default-branch Git tree with the complete Actions workflow registry so deleted workflow files cannot silently leave active orphan identities. Its evidence is not protected truth until integration and it does not authorize workflow-state mutation.
