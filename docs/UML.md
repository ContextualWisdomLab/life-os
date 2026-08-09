# LifeOS UML and Interaction Views

**Status:** Implemented on active PR

These diagrams describe current protected-main behavior unless a node is explicitly marked `Partial` or `Planned`.

## Bounded-context topology

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
    N --> NDB[(notification-owned PostgreSQL)]
    A --> ADB[(AI-owned PostgreSQL)]
    V --> VDB[(privacy-owned PostgreSQL)]
```

## Login and workspace sequence

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
    Identity->>Identity: provision/authorize personal workspace
    Identity-->>Web: revocable session + opaque account/workspace UUIDv4
    Web-->>Browser: secure session cookie
```

## Goal / Project / Task / Today lifecycle

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

## Data-rights sequence

```mermaid
sequenceDiagram
    participant User
    participant Web
    participant Identity
    participant Domains as Registered domain participants
    User->>Web: export/delete request
    Web->>Identity: validate session + recent-auth provenance
    Identity->>Identity: bind request to workspace/requesting user
    Identity->>Identity: persist durable request receipt
    Identity->>Domains: bounded export / prepare-delete orchestration
    Domains-->>Identity: domain evidence
    Identity-->>User: bounded status / result
```

Recent-auth provenance, ownership binding, durable request/terminal receipt and tenant-scoped status lookup are protected-main behavior. Complete domain participation, durable reconciliation, retention/legal-hold and protected archive delivery remain **Partial** under issue #55.

## Backup / restore

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

```mermaid
flowchart TB
    Ingress[Ingress / TLS] --> Web[Web/BFF]
    Web --> Services[Independent LifeOS services]
    Services --> IStore[(identity role/schema)]
    Services --> PStore[(planning role/schema)]
    Services --> HStore[(habit role/schema)]
    Services --> NStore[(notification role/schema)]
    Services --> AStore[(AI role/schema)]
    Services --> VStore[(privacy role/schema)]
    Services <--> NATS[(NATS JetStream)]
    Operator[Operator secret manager / network policy / backups / monitoring] -. configures .-> Services
```

The nodes represent separate service-owned database authority even when an operator co-locates them on one PostgreSQL cluster.

## Degraded modes

```mermaid
flowchart LR
    ProviderDown[Identity/calendar/model provider unavailable] --> BoundedFailure[Sanitized dependency-unavailable result]
    DbDown[Owning DB unavailable] --> NoFalseSuccess[Fail without durable-success claim]
    StaleWrite[Stale revision/precondition] --> Conflict[Explicit conflict]
    BadContext[Malformed/forged context] --> Deny[Fail closed]
    ModelDown[Model unavailable] --> Deterministic[Deterministic product gates remain available]
```
