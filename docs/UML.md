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

## Planning, Habit, Review, and Today authority

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

PR #150 protects connection metadata, PR #153 protects atomic local revocation, PR #155 protects `life-os.calendar-user.v1`, PR #176 protects exact lookup evidence, PR #189 protects bounded read, PR #193 protects materialization, and PR #197 protects authenticated creation.

### Protected compensation hardening

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Caller
    participant Create as Calendar create application
    participant SecretStore
    participant Repository
    Caller->>Create: signed workspace+user authority + bounded credentials
    Create->>SecretStore: store access material
    SecretStore-->>Create: opaque access handle
    Create->>SecretStore: store refresh material
    SecretStore-->>Create: opaque refresh handle
    Create->>Repository: persist metadata + exact handles
    Repository-->>Create: mismatched durable evidence
    Create->>SecretStore: delete refresh handle
    Create->>SecretStore: delete access handle
    Create-->>Caller: bounded dependency failure
```

This PR #201 flow is protected-main evidence. Complete KMS/OAuth/refresh/provider cleanup/discovery/selection/scoped sync remains **Partial** under #129.

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

PR #159 protects the shared contract. Planning is protected through PR #179 and PR #194. Habit is protected through PR #184 and PR #192. Review PR #195, Notification PR #198, and AI PR #199 are **Implemented on active PR**. Issue #55 remains **Partial**.

### Contributor maturity

```mermaid
flowchart LR
    Contract[PR #159 contributor v1] --> Planning[Planning: protected PR #179/#194]
    Contract --> Habit[Habit: protected PR #184/#192]
    Contract --> Review[Review: active PR #195]
    Contract --> Notification[Notification: active PR #198]
    Contract --> AI[AI: active PR #199]
    Contract --> Remaining[Remaining owners + reconciliation/delivery]
    Remaining --> Gap[Issue #55 Partial]
```

## Plugin installation, credential, and operator authority

**Status:** Partial

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

```mermaid
flowchart LR
    Manifest[Manifest intent] --> HostGrant[Host grant]
    HostGrant --> Installation[Durable installation]
    Installation --> SecretRef[Opaque secret reference]
    Installation --> Operator[Request-bound operator]
    HostOrigin[Separately host-authorized delivery origin] -. Planned .-> Delivery[Bounded HTTPS delivery]
    SecretRef -. no plaintext persistence .-> Delivery
    Operator -. no arbitrary network authority .-> Delivery
```

Concrete KMS, authorized-origin registry, SSRF/DNS-rebinding-safe delivery, outcomes, retry/dead-letter, and operator recovery remain **Partial** under #130.

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

## Model-assisted evaluation and repository authority

**Status:** Accepted architecture

```mermaid
flowchart LR
    Secret[GitHub Secret NVIDIA_NIM_API_KEY] --> Seed[Approved contextual-orchestrator / credential seeding]
    Seed --> Route[Strong single-route baseline]
    Seed --> Conduct[Bounded conduct cells]
    Route --> Evaluator[deterministic LifeOS proposal evaluator]
    Conduct --> Evaluator
    Evaluator --> Evidence[Credential-free retained evidence]
    Evidence --> Governance[Repository-specific governance decision]

    CI[Deterministic CI/security] --> Review[Independent review authority]
    Review --> Merge[Merge authority]
    Merge --> Release[Release authority]
    Governance -. evidence only .-> Review
    Seed -. no review/merge/release authority .-> Review
```

Supported controls may include workflow stage, reasoning effort, decomposition, recursion depth, role-specific reasoning effort, worker/model choice, verifier topology, and access/communication topology. Unsupported controls remain explicit. PR #200 is **Implemented on protected main** only for restoring the exact pinned OpenCode postinstall boundary.

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
| Identity/calendar/model provider unavailable | Bounded dependency failure; unrelated domains remain usable where safe | Accepted architecture |
| Owning PostgreSQL unavailable | Durable mutation fails closed; local draft remains visibly non-durable | Implemented on protected main |
| NATS unavailable | No fabricated delivery success; replay/recovery evidence remains | Implemented on protected main |
| Stale write | Explicit conflict/revision evidence, never silent overwrite | Implemented on protected main |
| Malformed/forged service context | Fail closed without reflecting identifiers or secrets | Implemented on protected main |
| Unknown/stale verification identity | Non-passing evidence, never promoted success | Implemented on protected main |
| Partial external secret/provider cleanup | Retain retry identity without restoring revoked authority | Partial |
