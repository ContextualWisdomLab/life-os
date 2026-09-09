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
- Active-PR contracts are not shipped API authority until normal protected integration.

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
| Calendar encrypted self-hosted secret storage | Calendar Integration | Implemented on protected main | PR #203; Calendar-owned AES-256-GCM file-store profile |
| Hosted Calendar credential admission | Calendar Integration | Implemented on active PR | PR #216 rejects deployment-wide Google/CalDAV credentials as user authority |
| Google OAuth authorization state / PKCE | Calendar Integration | Implemented on active PR | PR #228; bounded one-time state and secret-held verifier; callback/token exchange not included |
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
| Plugin delivery-origin aggregate/grant | Integration | Implemented on active PR | PR #205 plus active PostgreSQL/runtime descendants; durable exact HTTPS origin is not network authorization |
| Plugin Vault secret-store/operator runtime | Integration | Implemented on active PR | PR #242/#243/#244/#245; provider plaintext remains Vault-owned and LifeOS rows retain opaque references |
| Signed plugin delivery-origin operator application | Integration | Implemented on active PR | PR #250 exact signed grant/read/revoke application authority; no public HTTP delivery-origin route yet |
| Complete plugin secret/outbound runtime | Integration | Partial | issue #130 |
| First-party authenticated Goal BFF | Web/Gateway + Planning | Implemented on active PR | PR #214; browser credential is not forwarded and workspace/request authority stays server-side |
| Durable Goals workspace | Web/PWA | Implemented on active PR | PR #229; validated server-authoritative evidence only |
| Durable Weekly Review workspace | Web/PWA + Review | Implemented on active PR | PR #234; persistence-aligned ritual/period uniqueness; authoritative Planning/Habit read projections remain open |
| Complete first-party buyer journey | Web/PWA + BFF/services | Partial | issue #209 |
| Source/live-base/integration verification | Repository workflows | Implemented on protected main | PR #154; residual central taxonomy issue #132 |
| Exact pinned OpenCode bootstrap allowlist | Repository automation | Implemented on protected main | PR #200 historical bootstrap authority |
| Contextual-orchestrator model route | Repository automation | Implemented on active PR | PR #208 exact OpenCode identity + virtual `orchestrator/free`; blocked on immutable owner authentication/bootstrap release |
| Actions workflow-registry orphan detector | Repository automation | Implemented on active PR | PR #204; read-only exact-tree/registry evidence and no workflow-mutation authority |
| Release evidence structural index | Release tooling | Implemented on active PR | PR #217; exact-source structural admission only |
| Detached release signature verification | Release tooling | Implemented on active PR | PR #236; bounded Ed25519 verification/operator CLI |
| Immutable commercial release | Release tooling + protected main | Partial | issue #210 |

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
- PR #201 protects reverse-order compensation of all newly materialized handles when returned durable create evidence mismatches exact identity/handles.
- PR #203 provides the concrete Calendar-owned encrypted self-hosted secret-store profile.

### Hosted OAuth ceremony

**Status:** Implemented on active PR

PR #216 fails hosted startup closed rather than accepting process-global Google/CalDAV provider credentials as end-user authority. PR #228 adds an opaque, expiring, one-time Google OAuth authorization-state contract bound to exact workspace/user/provider/redirect evidence and an opaque PKCE-verifier secret reference. The repository-returned consumed row is revalidated before secret materialization.

This active contract does not claim callback/token exchange, provider token persistence, successful verifier cleanup after exchange, concrete PostgreSQL OAuth-state runtime, refresh fencing, provider-side revoke/delete recovery, calendar discovery/selection or scoped synchronization. Those remain **Partial** under #129.

## Plugin installation, credentials, and operator composition

### Installation and credential binding

**Status:** Implemented on protected main

PR #151 treats a manifest as requested intent. PR #169 persists exact bounded installation authority. PR #172 materializes credentials only through `PluginSecretStore` and persists only an opaque reference. PR #175 rejects mismatched returned installation identity.

Exact replay cannot rematerialize or overwrite an existing secret. Conflicting durable winners trigger compensation. Revocation ends durable authority before external cleanup and never restores authority during retry.

### Operator requests

**Status:** Implemented on protected main

PR #191 binds installation/workspace/actor, exact method/path, freshness, and one-time evidence to an atomic replay store. PR #196 composes this authority behind a fail-closed HTTP boundary and maps malformed JSON, stale/replayed evidence, absent dependencies, and invalid durable evidence to bounded credential-free problems.

No operator route grants arbitrary SQL, filesystem, subprocess, tool, or network authority.

### Delivery-origin, Vault, and hosted Integration composition

**Status:** Implemented on active PR

PR #205 establishes a host-owned exact normalized HTTPS origin scoped to opaque UUIDv4 grant, installation, workspace, and granting-user identities. PR #235 adds service-owned PostgreSQL grant persistence and active-installation fencing; PR #241 strengthens credential/revocation admission; PR #242 adds the Vault KV v2 `PluginSecretStore`; PR #243/#244 compose authenticated Vault operator authority and the shared Integration-owned PostgreSQL pool; PR #245 supplies the concrete hosted/default-entrypoint runtime.

Draft PR #250 composes existing delivery-origin authority only through exact signed one-time operator grant/read/revoke application methods. The canonical route verifier accepts only lowercase UUIDv4 delivery-origin collection/item/revoke paths and their exact POST/GET/POST methods. This is an internal application authority contract: #250 deliberately adds no public HTTP delivery-origin route and performs no outbound HTTPS.

A durable origin grant never authorizes a resolved IP address, DNS rebinding result, redirect, proxy route, or later connection. Immutable/versioned canonical egress authority, connect-time SSRF enforcement, bounded response/time behavior, delivery attempts/outcomes, retry/dead-letter and operator recovery remain **Partial** under #130.

## First-party buyer-path contracts

**Status:** Partial

Issue #209 is the commercial first-party Goals → Projects → Tasks → Habits → Review path. PR #214's active BFF contract authenticates through Identity, derives workspace authority server-side, signs the exact Planning method/path, forwards no browser credential downstream, and validates bounded returned ownership/schema evidence. PR #229 renders and mutates only validated durable Goal evidence. The stacked PR #234 Review page likewise consumes only browser-safe Review evidence and preserves persistence invariants such as one completion per `(workspace_id, ritual_kind, period_start_date)`.

The active stack is not shipped. Complete contract acceptance still requires all prerequisite BFF/workspace descendants, Figma/Storybook identity, normal/loading/empty/error/permission/responsive/interaction and keyboard/a11y states, authoritative Review Planning/Habit projections, and KO/EN/JA/ZH/VI/ES/DE/FR translation-ledger parity on current exact heads.

## Model-assisted development contract

**Status:** Partial

Protected PR #200 authorizes only the exact reviewed OpenCode bootstrap surface; it does not authorize direct provider model selection. Active PR #208 routes model-assisted work through contextual-orchestrator and virtual `orchestrator/free`. Provider credentials remain owner-side bootstrap material. LifeOS cannot promote the consumer until contextual-orchestrator repairs the currently mismatched authentication/bootstrap contract, publishes an immutable reviewed release, and the exact released LifeOS consumer passes acceptance. Mutable source copying or direct-provider fallback is not a compatibility mechanism.

## Release evidence contract

**Status:** Partial

Active Draft #217 structurally validates one exact release-evidence index, including artifact/checksum/provenance/signature coverage and bounded nightly identity. Stacked #236 verifies detached Ed25519 evidence and provides a bounded operator interface. These contracts do not publish a release or distribute/rotate/revoke trust roots. #210 remains open until an unchanged protected release source is bound to version/CHANGELOG/tag/package, immutable artifact, SBOM, provenance/signature, reproducibility and rollback/recovery acceptance.

## Events

Asynchronous events use opaque event IDs, explicit type/version, validated workspace/actor/correlation/causation context, bounded immutable payloads, and idempotent consumers. PR #190 binds protected integration event authority to the exact request. Receiving an event never grants producer-database authority.

## Versioning and compatibility

Breaking route/event/schema semantics require explicit versioning or a reviewed migration contract. Additive optional fields remain bounded and default-safe. Unknown versions fail closed. Migration rollback never fabricates restored external secret/provider state.

## Verification evidence identity

**Status:** Accepted architecture

`source_head_sha`, `pr_base_snapshot_sha`, `live_base_tip_sha`, integration/synthetic tree identity, `workflow_checkout_sha`, `protected_main_sha`, and `release_source_sha` are separate authorities. PR #154 protects source and live-base compatibility separation. Issue #132 remains **Partial** for central reusable scanner attribution; a synthetic merge scan cannot be called exact-source evidence.

PR #204 is an active, read-only extension that compares one exact protected-default-branch Git tree with the complete Actions workflow registry so deleted workflow files cannot silently leave active orphan identities. Its evidence is not protected truth until integration and it does not authorize workflow-state mutation.
