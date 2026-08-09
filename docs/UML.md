# LifeOS UML and Interaction Views

**Baseline:** protected `main` at `876850018a17323900844e79845ba395b7bf6a9a`

These diagrams are architecture documentation, not proof that every target path is fully implemented. Sections explicitly state current status. Service names and authority boundaries must remain synchronized with protected-main code and current active-PR evidence.

## 1. Component / bounded-context view

**Status:** Implemented on protected main

The bounded contexts and service-owned persistence ports shown here exist on protected main. Some external-credential and complete buyer journeys remain partial and are called out in the scoped sections below.

```mermaid
flowchart TB
    User[User]
    Web[Next.js Web / PWA]
    Gateway[Gateway / BFF]
    Identity[Identity Service]
    Planning[Planning Service]
    Habit[Habit Service]
    Review[Review Service]
    Calendar[Calendar Integration Service]
    Notification[Notification Service]
    AI[AI Proposal Service]
    Privacy[Privacy Access Service]
    Plugin[Plugin Integration Service]
    NATS[(NATS JetStream)]

    User --> Web
    Web --> Gateway
    Gateway --> Identity
    Gateway --> Planning
    Gateway --> Habit
    Gateway --> Review
    Gateway --> AI
    Gateway --> Privacy
    Gateway --> Calendar
    Gateway --> Plugin

    Planning -. publishes domain events .-> NATS
    Habit -. publishes domain events .-> NATS
    Review -. publishes projection/events .-> NATS
    NATS -. delivers reminder/event inputs .-> Notification

    Identity --> IdentityDB[(Identity-owned PostgreSQL schema / role)]
    Planning --> PlanningDB[(Planning-owned PostgreSQL schema / role)]
    Habit --> HabitDB[(Habit-owned PostgreSQL schema / role)]
    Review --> ReviewDB[(Review-owned PostgreSQL schema / role)]
    Notification --> NotificationDB[(Notification-owned PostgreSQL schema / role)]
    AI --> AIDB[(AI-owned PostgreSQL schema / role)]
    Privacy --> PrivacyDB[(Privacy-owned PostgreSQL schema / role)]

    Calendar --> ExternalCalendar[Google Calendar / CalDAV]
    Identity --> IdentityProvider[Google / GitHub Identity]
    AI --> ModelBoundary[Local rule model or approved contextual-orchestrator/model boundary]
```

Each database edge above represents only the owning service's persistence port. Co-location on one PostgreSQL cluster does not imply shared credentials, cross-service table access, or foreign-key authority.

## 2. Login and workspace authorization sequence

**Status:** Implemented on protected main

Identity OAuth/session behavior is implemented. Exact personal-workspace provisioning details follow current identity protected-main source and tests rather than this diagram alone.

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Gateway
    participant Identity
    participant Provider as Google/GitHub
    participant Domain as Planning or other domain service

    User->>Web: Start sign-in
    Web->>Gateway: Auth start request
    Gateway->>Identity: Begin provider flow
    Identity->>Provider: OAuth/OIDC authorization
    Provider-->>Identity: Callback data
    Identity->>Identity: Validate provider/state and map external identity
    Identity->>Identity: Establish revocable LifeOS session/workspace authority
    Identity-->>Web: Secure browser session boundary
    User->>Web: Open tenant-scoped feature
    Web->>Gateway: Browser request + session
    Gateway->>Identity: Validate session / derive workspace+actor
    Identity-->>Gateway: Opaque LifeOS authority context
    Gateway->>Domain: Bounded request with derived/signed context
    Domain-->>Gateway: Tenant-scoped result
    Gateway-->>Web: Credential-free response
```

Provider credentials and browser cookies do not become arbitrary downstream-service inputs.

## 3. Goal → Project → Task and Habit lifecycle

**Status:** Implemented on protected main

Goal/project/task and recurring-habit persistence are implemented. This is a logical domain flow; physical relationships follow planning/habit service implementations. Milestones/task dependencies from historical planning are not shown as protected-main persisted states; see `docs/DATA_MODEL.md`.

```mermaid
stateDiagram-v2
    [*] --> Captured
    Captured --> Goal: classify as objective
    Captured --> Project: classify as coordinated outcome
    Captured --> Task: classify as actionable work
    Captured --> Habit: classify as recurring behavior

    Goal --> Project: create/support project
    Project --> Task: project action
    Habit --> HabitScheduled: recurrence creates due behavior

    Task --> TaskCompleted: explicit completion
    HabitScheduled --> HabitCompleted: explicit completion
    TaskCompleted --> ReviewEvidence
    HabitCompleted --> ReviewEvidence
    ReviewEvidence --> [*]
```

Review evidence does not directly rewrite planning/habit source-of-truth records.

## 4. Today planning and stale-state boundary

**Status:** Implemented on active PR

Protected main already has the Today action loop and local-draft/durable-record distinction. PR #127 implements the complete bounded durable Today aggregate, explicit local-to-durable synchronization, optimistic concurrency, idempotency and conflict/recheck browser journey for issue #121. This sequence must not be treated as protected-main evidence until that exact PR head merges.

```mermaid
sequenceDiagram
    actor User
    participant Browser as Web/PWA
    participant Gateway
    participant Planning

    User->>Browser: Capture / select Today priorities
    Browser->>Browser: Maintain explicitly labeled local draft state
    Browser->>Gateway: Check current durable Today state
    Gateway->>Planning: Tenant-scoped GET / durable aggregate lookup
    Planning-->>Gateway: Durable aggregate + strong revision evidence
    Gateway-->>Browser: Current durable evidence
    Browser->>Browser: Discard stale async response if ownership/query/navigation changed
    User->>Browser: Explicit save/load/reconcile action
    Browser->>Gateway: Mutation + If-Match/If-None-Match + idempotency evidence
    Gateway->>Planning: Authorized write derived from session workspace
    alt preconditions current
        Planning-->>Gateway: Accepted durable revision
        Gateway-->>Browser: Confirm durable state
    else stale/conflicting
        Planning-->>Gateway: Credential-free conflict/current revision evidence
        Gateway-->>Browser: Recheck and reconcile explicitly; no silent overwrite
    end
```

Issue #121 remains open until the reviewed implementation is protected-main evidence and its acceptance gates are complete.

## 5. Reminder delivery sequence

**Status:** Implemented on protected main

This sequence describes durable PostgreSQL reminder scheduling and in-app delivery behavior.

```mermaid
sequenceDiagram
    participant Scheduler
    participant Store as Notification-owned PostgreSQL Repository
    participant Gateway as In-app Delivery Gateway

    Scheduler->>Store: Claim due occurrence with bounded lease
    alt claim acquired
        Store-->>Scheduler: Fenced claim token
        Scheduler->>Scheduler: Apply timezone quiet-hour and fatigue policy
        alt deliver now
            Scheduler->>Gateway: Deliver with idempotent delivery key
            Gateway-->>Scheduler: Delivery outcome
            Scheduler->>Store: Append immutable outcome
        else defer
            Scheduler->>Store: Persist next due instant + immutable defer outcome
        end
    else already claimed/completed
        Store-->>Scheduler: No duplicate authority
    end
```

## 6. Calendar synchronization sequence

**Status:** Implemented on protected main

CalDAV/Google provider adapters are implemented. Hosted per-user Google credential persistence, refresh, revocation and provider/calendar selection remain `Partial` under issue #129.

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Gateway
    participant Calendar
    participant Provider as Google Calendar / CalDAV

    User->>Web: Synchronize selected commitment
    Web->>Gateway: Authorized sync intent
    Gateway->>Calendar: Tenant-scoped bounded command
    Calendar->>Calendar: Validate provider configuration + deterministic remote identity
    Calendar->>Provider: Create/update with strong precondition where supported
    alt provider accepts
        Provider-->>Calendar: Remote ID / ETag
        Calendar-->>Gateway: Bounded sync result
        Gateway-->>Web: Success evidence
    else precondition/provider failure
        Provider-->>Calendar: Conflict/error
        Calendar-->>Gateway: Sanitized classified failure
        Gateway-->>Web: Recover/retry/reconcile state
    end
```

## 7. AI proposal and explicit decision sequence

**Status:** Implemented on protected main

Proposal generation, persistence, evidence and decision history are implemented. This diagram does not imply automatic planning mutation.

```mermaid
sequenceDiagram
    actor User
    participant Web as Authenticated Web/BFF
    participant Identity
    participant AI as AI Proposal Service
    participant Audit as AI-owned Proposal Store

    User->>Web: Request proposal
    Web->>Identity: Resolve session authority
    Identity-->>Web: Workspace + actor
    Web->>AI: Signed method/path/workspace/actor + bounded context
    AI->>AI: Treat context/model output as untrusted and validate
    AI->>Audit: Persist immutable proposal evidence
    Audit-->>AI: Proposal revision/digest
    AI-->>Web: Inert proposal
    Web-->>User: Present proposal + evidence
    User->>Web: Explicit accept or reject
    Web->>AI: Decision bound to exact proposal revision/digest
    AI->>Audit: Append replay-safe decision event
    Audit-->>AI: Decision evidence
    AI-->>Web: Decision recorded
```

The AI service is not a generic planning command bus.

## 8. Purpose-bound privacy access sequence

**Status:** Implemented on protected main

The privacy-service authorization/grant/evidence core is implemented. Complete user-facing export/deletion orchestration remains `Partial` under issue #55.

```mermaid
sequenceDiagram
    participant Caller as Authorized Service/Operator Boundary
    participant Privacy as Privacy Access Service
    participant Store as Privacy-owned PostgreSQL Repository

    Caller->>Privacy: Signed actor/resource/purpose request
    Privacy->>Privacy: Validate context, purpose, bounds and policy
    Privacy->>Store: Append access decision
    alt denied
        Store-->>Privacy: Denial evidence
        Privacy-->>Caller: Sanitized denial
    else allowed
        Privacy->>Store: Persist bounded single-use/time-limited grant
        Store-->>Privacy: Grant evidence
        Privacy-->>Caller: Signed grant token/handle
        Caller->>Privacy: Consume grant for exact authorized operation
        Privacy->>Store: Atomically validate/consume and append event
        Privacy-->>Caller: Authorized result boundary
    end
```

No other bounded service is permitted to use this `Store`; other services interact with the privacy service through its reviewed API/context boundary.

## 9. Backup and restore state flow

**Status:** Implemented on protected main

The verified logical dump/restore tier is implemented. PITR is not claimed.

```mermaid
stateDiagram-v2
    [*] --> BackupRequested
    BackupRequested --> ArchiveCreated
    ArchiveCreated --> ChecksumRecorded
    ChecksumRecorded --> BackupComplete
    BackupComplete --> RestoreRequested
    RestoreRequested --> IntegrityVerified
    IntegrityVerified --> TargetChecked
    TargetChecked --> RestoreRunning: target deliberately empty
    TargetChecked --> RestoreRefused: non-empty/unsafe target
    RestoreRunning --> RestoreVerified
    RestoreVerified --> [*]
    RestoreRefused --> [*]
    IntegrityVerified --> RestoreRefused: checksum/corruption failure
```

## 10. Deployment topology

**Status:** Implemented on protected main

Compose and Kubernetes provider-neutral reference artifacts exist. Cluster, DB/NATS managed services, ingress/TLS/DNS, registry pipeline and secret manager remain operator-owned; `reference` describes scope rather than a separate implementation status.

```mermaid
flowchart TB
    Client[Browser / PWA]
    Ingress[Operator-owned HTTPS ingress]
    Web[Web workload]
    Gateway[Gateway workload]
    Identity[Identity workload]
    Planning[Planning workload]
    Habit[Habit workload]
    Review[Review workload]
    Notification[Notification workload]
    AI[AI workload]
    Privacy[Privacy workload]
    Integrations[Calendar / Plugin workloads]
    PG[(Operator-owned PostgreSQL cluster)]
    NATS[(Operator-owned NATS JetStream)]
    Secrets[Operator-owned Secret Manager / protected environment]
    Providers[Identity / Calendar / Model Providers]
    Metrics[Operator monitoring network]

    Client --> Ingress
    Ingress --> Web
    Ingress --> Gateway
    Web --> Gateway

    Gateway --> Identity
    Gateway --> Planning
    Gateway --> Habit
    Gateway --> Review
    Gateway --> AI
    Gateway --> Privacy
    Gateway --> Integrations

    Identity -->|identity-only DSN/role/schema| PG
    Planning -->|planning-only DSN/role/schema| PG
    Habit -->|habit-only DSN/role/schema| PG
    Review -->|review-only DSN/role/schema| PG
    Notification -->|notification-only DSN/role/schema| PG
    AI -->|ai-only DSN/role/schema| PG
    Privacy -->|privacy-only DSN/role/schema| PG

    Planning -. publishes .-> NATS
    Habit -. publishes .-> NATS
    Review -. publishes .-> NATS
    NATS -. delivers bounded inputs .-> Notification

    Secrets --> Gateway
    Secrets --> Identity
    Secrets --> Planning
    Secrets --> Habit
    Secrets --> Review
    Secrets --> Notification
    Secrets --> AI
    Secrets --> Privacy
    Secrets --> Integrations
    Identity --> Providers
    AI --> Providers
    Integrations --> Providers

    Gateway -. metrics .-> Metrics
    Identity -. metrics .-> Metrics
    Planning -. metrics .-> Metrics
    Habit -. metrics .-> Metrics
    Review -. metrics .-> Metrics
    Notification -. metrics .-> Metrics
    AI -. metrics .-> Metrics
    Privacy -. metrics .-> Metrics
    Integrations -. metrics .-> Metrics
```

A shared physical PostgreSQL cluster is only a deployment co-location choice: every service uses its own authorized DSN/role/schema boundary and may not traverse into another service's tables.

## 11. Failure and degraded-mode view

```mermaid
flowchart LR
    Request[User intent] --> Auth{Session/authority valid?}
    Auth -->|No| AuthFail[Credential-free auth failure]
    Auth -->|Yes| Domain{Owning domain available?}
    Domain -->|No| DomainFail[Classified dependency unavailable; no fabricated success]
    Domain -->|Yes| External{External provider required?}
    External -->|No| Complete[Complete local/domain operation]
    External -->|Yes| Provider{Provider available + preconditions valid?}
    Provider -->|Yes| Complete
    Provider -->|No| Degraded[Preserve local truth; return bounded retry/conflict/unavailable evidence]
```

A calendar/model/provider outage does not authorize LifeOS to fabricate successful synchronization, proposal quality, or external side effects.
