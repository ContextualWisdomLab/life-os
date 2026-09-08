# LifeOS UML, C4, Authority, and Recovery Views

**Status:** Implemented on active PR

Protected-main behavior is labeled explicitly. Active-PR diagrams describe reviewed branch scope only and are not shipped truth.

## C4 bounded-context topology

**Status:** Implemented on protected main

```mermaid
flowchart LR
    User[User / Operator] --> Web[Web / PWA]
    Web --> Gateway[Gateway / BFF]
    Gateway --> Identity[Identity]
    Gateway --> Planning[Planning]
    Gateway --> Habit[Habit]
    Gateway --> Review[Review]
    Gateway --> Calendar[Calendar Integration]
    Gateway --> Notification[Notification]
    Gateway --> AI[AI Proposal]
    Gateway --> Privacy[Privacy]
    Gateway --> Plugin[Plugin Integration]

    Planning -. versioned events .-> NATS[(NATS JetStream)]
    Habit -. versioned events .-> NATS
    Review -. projections/events .-> NATS
    NATS -. reminder inputs .-> Notification

    Identity --> IDB[(Identity-owned PostgreSQL)]
    Planning --> PDB[(Planning-owned PostgreSQL)]
    Habit --> HDB[(Habit-owned PostgreSQL)]
    Review --> RDB[(Review-owned PostgreSQL)]
    Calendar --> CDB[(Calendar-owned PostgreSQL)]
    Notification --> NDB[(Notification-owned PostgreSQL)]
    AI --> ADB[(AI-owned PostgreSQL)]
    Privacy --> VDB[(Privacy-owned PostgreSQL)]
    Plugin --> XDB[(Integration-owned PostgreSQL)]
```

No arrow authorizes cross-service SQL. Every service retains migrations, credentials, transactions, backup semantics, observability, and recovery ownership.

## Identity and workspace authority

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant Provider as Google/GitHub
    User->>Web: begin bounded login
    Web->>Identity: create OAuth transaction
    Identity->>Provider: authorize with exact redirect/state
    Provider-->>Identity: callback
    Identity->>Identity: validate provider/state/redirect
    Identity->>Identity: map user, workspace, authentication instant
    Identity-->>Web: revocable session
    Note over Identity: session rotation preserves authentication age
```

## Planning, Habit, Review, Today, and first-party journey

### Protected authority

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant Gateway
    participant Planning
    participant Habit
    participant Review

    User->>Web: open Today
    Web->>Identity: validate session
    Identity-->>Web: actor + workspace
    Web->>Gateway: authenticated Today request
    Gateway->>Planning: exact signed request context
    Planning-->>Gateway: bounded durable Today state
    Gateway->>Habit: exact signed request context
    Habit-->>Gateway: bounded Today habit state
    Gateway-->>Web: real composed Today response
    User->>Review: complete guided review
    Review->>Review: verify request-bound signed workspace context
```

PR #168 and PR #188 protect Planning authority; PR #173 protects Habit authority; PR #185 protects Review authority; PR #186 and PR #187 protect real Planning/Habit Gateway composition. Issue #163 is completed.

```mermaid
stateDiagram-v2
    [*] --> LocalDraft
    LocalDraft --> DurableToday: explicit server acceptance + strong precondition
    DurableToday --> DurableToday: exact replay or versioned update
    DurableToday --> Conflict: stale precondition
    Conflict --> DurableToday: explicit reconciliation
    DurableToday --> Completed
    Completed --> [*]
```

### Active first-party buyer journey

**Status:** Partial

```mermaid
sequenceDiagram
    actor User
    participant Browser as Web/PWA
    participant Identity
    participant BFF as First-party BFF
    participant Owner as Planning/Habit/Review

    User->>Browser: load workspace
    Browser->>BFF: browser-safe request
    BFF->>Identity: authenticate session/workspace
    Identity-->>BFF: exact actor + workspace
    BFF->>Owner: signed exact method/path authority
    Owner-->>BFF: bounded durable evidence
    BFF->>BFF: validate ownership/schema/evidence
    BFF-->>Browser: browser-safe durable projection
    User->>Browser: explicit mutation
    Browser->>BFF: bounded mutation input
    BFF->>Owner: authorized exact mutation
    Owner-->>BFF: durable acceptance evidence
    BFF-->>Browser: accepted durable record
```

Issue #209 is the complete Goals → Projects → Tasks → Habits → Review journey. PR #214 starts the active line with the authenticated Goal BFF; PR #229 adds the durable Goals workspace; stacked PR #234 is the current Weekly Review workspace. Browser state never creates workspace authority or durable identity. Completion still requires the full dependency stack, final current-head E2E, Figma/Storybook traceability, normal/loading/empty/error/permission/responsive/interaction states, keyboard/focus/reduced-motion/a11y, authoritative Review read projections, and KO/EN/JA/ZH/VI/ES/DE/FR parity.

## Calendar connection and credential lifecycle

### Protected-main lifecycle

**Status:** Implemented on protected main

```mermaid
stateDiagram-v2
    [*] --> MaterializingSecrets: authenticated create (PR #197)
    MaterializingSecrets --> PersistingMetadata: opaque handles only
    MaterializingSecrets --> Compensating: secret-store failure
    PersistingMetadata --> Active: exact returned authority validated
    PersistingMetadata --> Compensating: persistence throw or invalid evidence
    Active --> Active: authenticated read (PR #189)
    Active --> MaterializedForUse: exact handle validation (PR #193)
    MaterializedForUse --> Active: plaintext lifetime ends
    Active --> Revoked: authenticated local disconnect (PR #157)
    Revoked --> Revoked: exact replay
    Compensating --> [*]: reverse-order cleanup proven
```

PR #150 protects connection metadata, PR #153 protects atomic local revocation, PR #155 protects `life-os.calendar-user.v1`, PR #176 protects exact lookup evidence, PR #189 protects bounded read, PR #193 protects materialization, PR #197 protects authenticated creation, PR #201 protects returned-evidence compensation, and PR #203 protects the Calendar-owned encrypted self-hosted secret-store profile.

### Active hosted OAuth authority

**Status:** Partial

```mermaid
stateDiagram-v2
    [*] --> HostedAdmission
    HostedAdmission --> RejectedGlobalCredential: deployment-wide provider credential supplied
    HostedAdmission --> AuthorizationState: authenticated user-owned ceremony
    AuthorizationState --> PendingCallback: opaque state + PKCE verifier secret reference
    PendingCallback --> Consumed: exact state/workspace/user/provider/redirect + expiry accepted
    PendingCallback --> Rejected: expired/replayed/malformed/mismatched evidence
    Consumed --> VerifierMaterialized: revalidate consumed row before secret read
    VerifierMaterialized --> TokenExchangePending: active boundary ends
```

Active PR #216 provides the fail-closed hosted admission boundary. Stacked PR #228 provides five-minute OAuth state/PKCE authority with verifier plaintext outside durable metadata. `TokenExchangePending` is deliberately not implemented by this stack: hosted callback/token exchange, successful verifier cleanup, concrete PostgreSQL OAuth-state runtime, refresh fencing, provider revoke/delete recovery, discovery/selection and scoped synchronization remain **Partial** under #129.

## Data-rights orchestration and contributor authority

### Protected contributor contract

**Status:** Partial

```mermaid
sequenceDiagram
    actor User
    participant Identity
    participant Registry as Explicit participant registry
    participant Contributor as Owning service contributor
    participant Ledger

    User->>Identity: recent-authenticated export/delete request
    Identity->>Ledger: create/replay exact request
    Identity->>Registry: resolve exact required participants
    loop each owner
      Identity->>Contributor: versioned exact signed request
      Contributor->>Contributor: use owner persistence only
      Contributor-->>Identity: bounded export/preflight/erase/verify evidence
    end
    Identity->>Identity: reconcile exact participant set
    alt all required evidence verified
      Identity->>Ledger: append immutable terminal receipt
      Identity-->>User: bounded status/artifact lifecycle
    else partial/unavailable/unknown
      Identity-->>User: non-terminal or bounded failure
    end
```

PR #159 protects the shared contract. Planning is protected through PR #179 and PR #194. Habit is protected through PR #184 and PR #192. Review is protected through PR #195. Notification PR #198 and AI PR #199 are **Implemented on active PR**. Issue #55 remains **Partial**.

### Contributor maturity

```mermaid
flowchart LR
    Contract[PR #159 contributor v1] --> Planning[Planning: protected #179/#194]
    Contract --> Habit[Habit: protected #184/#192]
    Contract --> Review[Review: protected #195]
    Contract --> Notification[Notification: active #198]
    Contract --> AI[AI: active #199]
    Contract --> Remaining[Remaining owners + reconciliation/delivery]
    Remaining --> Gap[Issue #55 Partial]
```

## Plugin installation, credential, delivery-origin, and operator authority

**Status:** Partial

### Protected foundation

```mermaid
stateDiagram-v2
    [*] --> ValidatedManifest
    ValidatedManifest --> Granted: explicit host subset (PR #151)
    Granted --> Persisted: exact durable authority (PR #169/#175)
    Persisted --> CredentialBound: opaque secret reference (PR #172)
    CredentialBound --> OperatorAuthorized: exact one-time request (PR #191)
    OperatorAuthorized --> OperatorResult: fail-closed HTTP composition (PR #196)
    OperatorAuthorized --> ReplayDenied: reused evidence
    CredentialBound --> Revoked: durable authority ends first
    Revoked --> CleanupRetry: external secret cleanup retry
    CleanupRetry --> Revoked: authority never restored
```

### Active #130 persistence and operator stack

```mermaid
flowchart LR
    Manifest[Manifest intent] --> HostGrant[Explicit host grant]
    HostGrant --> Installation[Installation authority]
    Installation --> Credential[Opaque credential binding]
    Installation --> Origin[Exact HTTPS origin grant]
    Credential --> Vault[Vault KV v2]
    Installation --> IPG[(Integration-owned PostgreSQL)]
    Origin --> IPG
    Operator[One-time signed operator context] --> Credential
    Operator --> Origin
    Origin -. identity only .-> Egress[Future canonical egress authority]
    Egress -. connect-time policy .-> Network[Untrusted network]
```

Active #205 establishes the origin aggregate; #235 adds PostgreSQL grant persistence and installation fencing; #241 strengthens credential/revocation authority; #242 adds the Vault KV v2 secret store; #243/#244 compose Vault and one Integration-owned PostgreSQL pool; #245 supplies the concrete hosted/default-entrypoint runtime; #250 adds exact signed grant/read/revoke application authority for delivery origins.

```mermaid
sequenceDiagram
    participant Operator
    participant Verify as One-time operator verifier
    participant App as Delivery-origin application
    participant Install as Installation repository
    participant Origin as Delivery-origin store

    Operator->>Verify: signed exact method/path + actor/workspace/installation
    Verify->>Verify: validate freshness/signature + consume replay identity
    Verify->>App: exact authorized operation
    App->>Install: read active installation authority
    Install-->>App: exact durable evidence
    App->>Origin: grant/read/revoke exact origin evidence
    Origin-->>App: exact durable result
    App-->>Operator: bounded result
```

#250 deliberately stops here. No public delivery-origin HTTP transport or outbound HTTPS is implied. #130 remains **Partial** until immutable released/versioned canonical egress authority enforces connect-time DNS/IP/rebinding, redirect/proxy and bounded time/response policy and LifeOS persists delivery attempts/outcomes with retry/dead-letter, revocation fencing and operator recovery.

## AI proposal and explicit decision

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant AI
    participant Audit
    User->>Web: request proposal
    Web->>Identity: validate session
    Identity-->>Web: actor + workspace
    Web->>AI: exact signed bounded context
    AI->>AI: validate untrusted model result
    AI->>Audit: persist inert proposal evidence
    AI-->>User: proposal requiring confirmation
    User->>AI: explicit accept/reject bound to exact evidence
    AI->>Audit: append decision
    Note over AI,Audit: no generic Planning mutation authority
```

## Model-assisted development and repository authority

**Status:** Partial

```mermaid
flowchart LR
    OpenCode[Exact reviewed OpenCode] --> CO[contextual-orchestrator released API/client]
    Secrets[Provider credentials] --> CO
    CO --> Free[orchestrator/free]
    Free --> Model[Provider selected by owner]
    Model --> Evidence[Bounded credential-free retained evidence]
    Evidence --> CI[Deterministic CI/security]
    CI --> Review[Independent review authority]
    Review --> Merge[Protected merge authority]
    Merge --> Release[Release authority]
    Evidence -. no independent authority .-> Review
```

Protected #200 covers only the exact OpenCode bootstrap allowlist. Active #208 is the target routing line: exact OpenCode identity plus contextual-orchestrator/`orchestrator/free`, with provider credentials/model selection remaining owner-side. It fails closed pending a repaired authentication/bootstrap owner contract, immutable reviewed owner release, and exact released consumer acceptance. Mutable owner source or direct-provider fallback is not authorized.

## Verification evidence authority

**Status:** Implemented on protected main

```mermaid
flowchart LR
    Source[source_head_sha] --> SourceChecks[Exact-source checks]
    Snapshot[pr_base_snapshot_sha] --> Historical[Historical metadata]
    LiveBase[live_base_tip_sha] --> Integration[integration_tree_sha]
    Source --> Integration
    Integration --> Compatibility[Merge compatibility]
    SourceChecks --> Policy[Live policy decision]
    Compatibility --> Policy
    Policy --> Main[protected_main_sha]
    Main --> ReleaseSource[release_source_sha]
```

PR #154 protects exact-source/live-base separation. Issue #132 remains **Partial** for central reusable scanner checkout/attribution taxonomy. A green result never transfers across evidence identities.

## Release-evidence authority

**Status:** Partial

```mermaid
flowchart LR
    RS[Exact protected release_source_sha] --> Index[Release evidence index]
    RS --> Artifact[Package / image]
    Artifact --> Checksum[Checksums]
    Artifact --> SBOM[SBOM]
    Artifact --> Provenance[Provenance / attestation]
    Artifact --> Signature[Detached signatures]
    Checksum --> Verify[Structural + cryptographic verification]
    Provenance --> Verify
    Signature --> Verify
    Verify --> Publish[Immutable tag/package/release]
    Publish --> Install[Installed runtime acceptance]
    Install --> Recovery[Upgrade/rollback/restore/recovery]
```

Active Draft #217 provides structural index validation and #236 adds detached Ed25519 verification/operator tooling. The diagram's `Publish`, trust-root/key lifecycle, installed acceptance and recovery nodes remain **Partial** under #210 until proved on one unchanged protected release source.

## Deployment and recovery

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Client --> Ingress[Operator-owned TLS/DNS/ingress]
    Ingress --> Web
    Web --> Services[Independent LifeOS services]
    Services --> Stores[(Service-owned PostgreSQL authority)]
    Services <--> NATS[(NATS JetStream)]
    Services --> Providers[Identity / Calendar / Model / Plugin providers]
    Backup[Logical backup + integrity manifest] --> Restore[Validated safe-target restore]
    Restore --> Stores
```

```mermaid
stateDiagram-v2
    [*] --> Healthy
    Healthy --> Degraded: optional provider unavailable
    Healthy --> FailClosed: owning persistence/authority unavailable
    Degraded --> Healthy: bounded retry/recovery
    FailClosed --> Recovery: operator restores dependency/evidence
    Recovery --> Healthy: readiness + integrity verified
    Recovery --> FailClosed: evidence incomplete
```

Logical backup/restore does not claim PITR. External provider cleanup/recovery and release rollback preserve explicit partial-state evidence rather than fabricate success.

## Degraded-mode matrix

| Failure | Required behavior | Status |
| --- | --- | --- |
| Identity/calendar/model provider unavailable | bounded dependency failure; unrelated domains remain usable where safe | Accepted architecture |
| Owning PostgreSQL unavailable | durable mutation fails closed; local draft remains visibly non-durable | Implemented on protected main |
| Vault/secret store unavailable | credential/origin-dependent operation fails closed; no plaintext persistence fallback | Implemented on active PR |
| NATS unavailable | no fabricated delivery success; replay/recovery evidence remains | Implemented on protected main |
| Stale write | explicit conflict/revision evidence, never silent overwrite | Implemented on protected main |
| Malformed/forged service context | fail closed without reflecting identifiers or secrets | Implemented on protected main |
| Unknown/stale verification identity | non-passing evidence, never promoted success | Implemented on protected main |
| Partial external secret/provider cleanup | retain retry identity without restoring revoked authority | Partial |
| Missing canonical egress authority | plugin outbound delivery remains unavailable rather than treating stored origin as network authorization | Partial |
| Missing immutable contextual-orchestrator release/authentication contract | model-assisted lane fails closed; no direct-provider bypass | Partial |
| Release evidence mismatch or missing trust/recovery evidence | no immutable release promotion | Partial |
