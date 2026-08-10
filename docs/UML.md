# LifeOS UML and Interaction Views

**Status:** Implemented on active PR

These diagrams describe current protected-main behavior unless a section is explicitly labeled `Implemented on active PR`, `Partial`, `Planned`, or another canonical status.

## Bounded-context topology

**Status:** Implemented on protected main

```mermaid
flowchart LR
    U[Web / PWA] --> B[Gateway / BFF]
    B --> I[Identity]
    B --> P[Planning]
    B --> H[Habit]
    B --> R[Review]
    B --> C[Calendar]
    B --> N[Notification]
    B --> A[AI Proposal]
    B --> V[Privacy]
    B --> X[Plugin Integration]
    P -. domain events .-> J[(NATS JetStream)]
    H -. domain events .-> J
    R -. projection/events .-> J
    J -. reminder/event inputs .-> N

    I --> IDB[(identity-owned PostgreSQL)]
    P --> PDB[(planning-owned PostgreSQL)]
    H --> HDB[(habit-owned PostgreSQL)]
    R --> RDB[(review-owned PostgreSQL)]
    N --> NDB[(notification-owned PostgreSQL)]
    A --> ADB[(AI-owned PostgreSQL)]
    V --> VDB[(privacy-owned PostgreSQL)]
```

Physical co-location does not grant cross-service table authority.

## Login and workspace sequence

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Browser
    participant Web
    participant Identity
    participant Provider as Google/GitHub
    Browser->>Web: begin login
    Web->>Identity: create bounded OAuth transaction
    Identity->>Provider: authorization request
    Provider-->>Identity: callback code/state
    Identity->>Identity: validate provider/state/redirect and map external identity
    Identity->>Identity: provision/authorize personal workspace + authentication instant
    Identity-->>Web: revocable session + opaque account/workspace UUIDv4
    Web-->>Browser: secure session cookie
```

Session rotation does not manufacture a new authentication ceremony.

## Goal / Project / Task / Today lifecycle

**Status:** Implemented on protected main

```mermaid
stateDiagram-v2
    [*] --> LocalDraft
    LocalDraft --> DurableToday: explicit save + If-None-Match/If-Match
    DurableToday --> DurableToday: versioned update
    DurableToday --> Conflict: stale strong precondition
    Conflict --> DurableToday: recheck + explicit reconciliation
    DurableToday --> Completed: explicit completion
    Completed --> [*]
```

The durable Today aggregate, local-to-workspace migration, replay protection and stale reconciliation are implemented on protected main through PR #127.

## Review flow

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant User
    participant Review
    participant Planning
    participant Habit
    User->>Review: start daily/weekly review
    Review->>Planning: read bounded planning evidence
    Review->>Habit: read completion evidence
    Review->>Review: build review projection/snapshot
    Review-->>User: guided review result
    Note over Review,Planning: Review never mutates Planning tables directly.
```

## Calendar synchronization

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Web
    participant Identity
    participant Calendar
    participant Provider
    Web->>Identity: validate session / derive workspace
    Identity-->>Web: workspace authority
    Web->>Calendar: signed workspace context + bounded sync request
    Calendar->>Calendar: verify signature, issuance, method/path and UUIDv4 workspace
    Calendar->>Provider: conflict-safe provider operation
    Provider-->>Calendar: bounded untrusted response
    Calendar-->>Web: sanitized sync result
```

Per-user encrypted credential persistence/refresh/revocation and calendar selection are **Partial** and tracked by issue #129.

## AI proposal / evidence / decision

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Browser
    participant Web
    participant Identity
    participant AI
    participant Audit
    Browser->>Web: proposal request
    Web->>Identity: validate session
    Identity-->>Web: actor + workspace UUIDv4
    Web->>AI: signed actor/workspace/method/path context
    AI->>AI: bound/validate untrusted model output
    AI->>Audit: persist immutable proposal evidence
    AI-->>Web: inert proposal
    Browser->>Web: explicit accept/reject
    Web->>AI: authorized decision bound to proposal digest/revision
    AI->>Audit: append decision evidence
```

## Data-rights durable foundation

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant User
    participant Web
    participant Identity
    participant Ledger as identity.data_rights_requests
    User->>Web: export/delete request
    Web->>Identity: validate session + recent-auth provenance
    Identity->>Ledger: persist workspace/user-bound request
    Ledger-->>Identity: durable request / replay / conflict
    Identity->>Ledger: tenant-and-requesting-actor scoped lookup
    Ledger-->>Identity: request state or indistinguishable absence
```

Recent-auth provenance, ownership binding, durable request/terminal receipt and tenant-scoped status lookup are protected-main behavior through #134/#136/#137/#138/#144.

## Authenticated data-rights status resource

**Status:** Implemented on active PR

**Evidence:** PR #146.

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity as Identity HTTP boundary
    participant Session as Session introspection
    participant Ledger as Request ledger

    User->>Identity: GET /v1/data-rights/requests/:requestId + opaque session cookie
    Identity->>Session: introspect cookie
    Session-->>Identity: userId + workspaceId
    Identity->>Ledger: getRequest(requestId, workspaceId, userId)
    alt owned request
        Ledger-->>Identity: durable request
        Identity-->>User: 200 bounded public lifecycle + no-store
    else absent or other tenant
        Ledger-->>Identity: undefined
        Identity-->>User: indistinguishable 404 + no-store
    else malformed request ID
        Identity-->>User: bounded 400 + no-store
    else invalid/expired session
        Identity-->>User: bounded 401 + no-store
    else dependency/persistence failure
        Identity-->>User: sanitized 503 + no-store
    end
```

The public projection excludes workspace/user IDs, idempotency keys and request/receipt digests. Complete contributor orchestration, reconciliation, retention/legal-hold and protected export delivery remain **Partial** under issue #55.

## Purpose-bound sensitive-data access

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Caller
    participant Privacy
    participant Audit
    Caller->>Privacy: actor + workspace + resource + purpose + lifetime
    Privacy->>Privacy: validate policy/scope
    Privacy->>Audit: append decision/grant evidence
    Privacy-->>Caller: bounded grant/decision or denial
```

## Backup / restore

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Operator
    participant Backup
    participant Store
    participant Restore
    Operator->>Backup: logical backup
    Backup->>Backup: produce integrity/checksum evidence
    Backup->>Store: write backup artifact
    Operator->>Restore: restore into approved target
    Restore->>Restore: reject corruption / unsafe non-empty target
    Restore-->>Operator: verified restore evidence
```

## Deployment topology

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Ingress[Ingress / TLS] --> Web[Web/BFF]
    Web --> Services[Independent LifeOS services]
    Services --> IStore[(identity role/schema)]
    Services --> PStore[(planning role/schema)]
    Services --> HStore[(habit role/schema)]
    Services --> RStore[(review role/schema)]
    Services --> NStore[(notification role/schema)]
    Services --> AStore[(AI role/schema)]
    Services --> VStore[(privacy role/schema)]
    Services <--> NATS[(NATS JetStream)]
    Operator[Operator secret manager / network policy / backups / monitoring] -. configures .-> Services
```

The nodes represent separate service-owned database authority even when an operator co-locates them on one PostgreSQL cluster.

## Verification evidence identity

**Status:** Implemented on active PR

**Evidence:** ADR 0010 and PR #147.

The exact **source head** and a GitHub **synthetic merge** tree are different evidence subjects. The PR base snapshot is also distinct from the current live base tip.

```mermaid
flowchart LR
    Source[source_head_sha] --> SourceCheck[Exact source verification]
    BaseSnapshot[pr_base_snapshot_sha] --> PRMetadata[Historical PR-base evidence]
    LiveBase[live_base_tip_sha] --> MergeDecision[Current base-sensitive decision]
    Source --> MergeTree[merge_tree_sha]
    LiveBase --> MergeTree
    MergeTree --> MergeCheck[Integration compatibility]
    SourceCheck --> Gate[Merge/release evidence decision]
    MergeCheck --> Gate
    MergeDecision --> Gate
    Gate --> Main[protected_main_sha]
    Main --> Release[release_source_sha]
```

```mermaid
sequenceDiagram
    participant GitHub
    participant SourceJob as source-head job
    participant MergeJob as merge-compatibility job
    participant Policy as merge policy

    GitHub->>SourceJob: checkout exact contributor source head
    SourceJob-->>Policy: source-head evidence
    GitHub->>MergeJob: checkout/construct synthetic merge against current base
    MergeJob-->>Policy: separately classified compatibility evidence
    Policy->>GitHub: re-resolve live base before base-sensitive decision
```

No green status is silently transferred across these identities. Issue #132 remains open until the active implementation is integrated and residual required-workflow attribution is reconciled.

## Degraded modes

**Status:** Accepted architecture

```mermaid
flowchart LR
    ProviderDown[Identity/calendar/model provider unavailable] --> BoundedFailure[Sanitized dependency-unavailable result]
    DbDown[Owning DB unavailable] --> NoFalseSuccess[Fail without durable-success claim]
    StaleWrite[Stale revision/precondition] --> Conflict[Explicit conflict]
    BadContext[Malformed/forged context] --> Deny[Fail closed]
    ModelDown[Model unavailable] --> Deterministic[Deterministic product gates remain available]
    UnknownEvidence[Unknown workflow checkout/evidence identity] --> EvidenceUnavailable[Fail closed / unavailable evidence]
```
