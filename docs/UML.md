# LifeOS UML and Interaction Views

**Baseline:** protected `main` at `5c87a7ec3568a4ce47b25cad843f1bc5be91b294`

These diagrams are architecture documentation, not proof that every target path is fully implemented. Sections explicitly state current status. Service names and authority boundaries must remain synchronized with protected-main code.

## 1. Component / bounded-context view

**Status:** Implemented on protected main, with some external-credential/product journeys partial.

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

    Planning -. domain events .-> NATS
    Habit -. domain events .-> NATS
    Review -. projection/events .-> NATS
    Notification -. consumes reminder/event inputs .-> NATS

    Calendar --> ExternalCalendar[Google Calendar / CalDAV]
    Identity --> IdentityProvider[Google / GitHub Identity]
    AI --> ModelBoundary[Local rule model or approved contextual-orchestrator/model boundary]
```

Every service owns its persistence. No arrow in this diagram authorizes direct cross-service SQL access.

## 2. Login and workspace authorization sequence

**Status:** Identity OAuth/session behavior implemented; exact personal-workspace provisioning details follow identity protected-main source.

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

**Status:** Goal/project/task and recurring-habit persistence are implemented. This is a logical domain flow; physical relationships follow planning/habit service implementations.

```mermaid
stateDiagram-v2
    [*] --> Captured
    Captured --> Goal: classify as objective
    Captured --> Project: classify as coordinated outcome
    Captured --> Task: classify as actionable work
    Captured --> Habit: classify as recurring behavior

    Goal --> Project: create/support project
    Goal --> Task: direct next action
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

**Status:** Today action loop and local-draft/durable-record distinction are implemented. Full multi-device optimistic-concurrency synchronization of a complete durable Today aggregate is partial.

```mermaid
sequenceDiagram
    actor User
    participant Browser as Web/PWA
    participant Gateway
    participant Planning

    User->>Browser: Capture / select Today priorities
    Browser->>Browser: Maintain explicitly labeled local draft state
    Browser->>Gateway: Search or durable planning request
    Gateway->>Planning: Tenant-scoped request
    Planning-->>Gateway: Durable goals/projects/tasks + revision evidence where available
    Gateway-->>Browser: Current durable evidence
    Browser->>Browser: Discard stale async response if ownership/query/navigation changed
    User->>Browser: Explicit durable mutation
    Browser->>Gateway: Mutation + concurrency/idempotency evidence
    Gateway->>Planning: Authorized write
    alt preconditions current
        Planning-->>Gateway: Accepted durable revision
        Gateway-->>Browser: Confirm durable state
    else stale/conflicting
        Planning-->>Gateway: Credential-free conflict/current revision evidence
        Gateway-->>Browser: Reconcile explicitly; no silent overwrite
    end
```

The final full-aggregate concurrency contract is a product gap until current protected-main code proves it end-to-end.

## 5. Reminder delivery sequence

**Status:** Implemented on protected main for durable PostgreSQL reminder scheduling/in-app delivery behavior.

```mermaid
sequenceDiagram
    participant Scheduler
    participant Store as Notification PostgreSQL Repository
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

**Status:** CalDAV/Google provider adapters implemented; hosted per-user Google token persistence/refresh/revocation is partial.

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

**Status:** Implemented on protected main for proposal generation/persistence/evidence/decision history. This diagram does not imply automatic planning mutation.

```mermaid
sequenceDiagram
    actor User
    participant Web as Authenticated Web/BFF
    participant Identity
    participant AI as AI Proposal Service
    participant Audit as AI Proposal Store

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

**Status:** Implemented on protected main for privacy-service authorization/grant/evidence core; user-facing data-rights UX may remain partial.

```mermaid
sequenceDiagram
    participant Caller as Authorized Service/Operator Boundary
    participant Privacy as Privacy Access Service
    participant Store as Privacy PostgreSQL Repository

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

## 9. Backup and restore state flow

**Status:** Implemented logical dump/restore tier; PITR is not claimed.

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

**Status:** Compose and Kubernetes reference artifacts exist. Cluster, DB/NATS managed services, ingress/TLS/DNS, registry pipeline and secret manager remain operator-owned.

```mermaid
flowchart TB
    Client[Browser / PWA]
    Ingress[Operator-owned HTTPS ingress]
    Web[Web workload]
    Gateway[Gateway workload]
    Services[Bounded domain service workloads]
    PG[(Operator-owned PostgreSQL)]
    NATS[(Operator-owned NATS JetStream)]
    Secrets[Operator-owned Secret Manager / protected environment]
    Providers[Identity / Calendar / Model Providers]
    Metrics[Operator monitoring network]

    Client --> Ingress
    Ingress --> Web
    Ingress --> Gateway
    Web --> Gateway
    Gateway --> Services
    Services --> PG
    Services --> NATS
    Secrets --> Gateway
    Secrets --> Services
    Services --> Providers
    Gateway -. metrics .-> Metrics
    Services -. metrics .-> Metrics
```

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
