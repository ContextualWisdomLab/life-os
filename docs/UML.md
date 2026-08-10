# LifeOS UML and Interaction Views

**Status:** Accepted architecture  
**Baseline:** protected `main` at `dcc787f77b708cecda054b47d6f7d7b561575a67`

Every view labels maturity. An active PR or planned target is never represented as protected-main behavior.

## 1. Bounded-context topology

**Status:** Implemented on protected main

```mermaid
flowchart LR
    User --> Web[Next.js Web / PWA]
    Web --> Gateway[Gateway / BFF]
    Gateway --> Identity[Identity]
    Gateway --> Planning[Planning]
    Gateway --> Habit[Habit]
    Gateway --> Review[Review]
    Gateway --> Notification[Notification]
    Gateway --> Calendar[Calendar]
    Gateway --> AI[AI]
    Gateway --> Plugin[Plugin integration]
    Gateway --> Privacy[Privacy]
    Planning -. events .-> NATS[(NATS)]
    Habit -. events .-> NATS
    NATS -. reminder/event input .-> Notification
```

Each service owns persistence/migrations/credentials even when an operator uses one physical PostgreSQL cluster.

## 2. Login and workspace authority

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant Provider as Google/GitHub
    participant Domain

    User->>Web: Start login
    Web->>Identity: Start bounded OAuth transaction
    Identity->>Provider: Authorization + state/PKCE
    Provider-->>Identity: Callback
    Identity->>Identity: Validate provider/state/redirect and resolve workspace
    Identity-->>Web: Revocable session
    User->>Web: Domain action
    Web->>Identity: Introspect session
    Identity-->>Web: actor/workspace/authentication provenance
    Web->>Domain: Trusted derived context
```

## 3. Goal -> Project -> Task / Habit -> Review

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Goal --> Project --> Task
    Goal -. motivates .-> Habit
    Project -. motivates .-> Habit
    Task --> TaskCompletion[Task completion]
    Habit --> HabitCompletion[Habit completion]
    TaskCompletion --> Review
    HabitCompletion --> Review
    Review -. projection only .-> PlanningView[Planning recommendations/view]
```

Review does not silently rewrite planning state.

## 4. Durable Today synchronization

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Browser as Local Today draft
    participant Web
    participant Identity
    participant Planning
    participant Pg as Planning PostgreSQL

    User->>Browser: Edit local plan
    User->>Web: Explicit Save
    Web->>Identity: Validate session
    Identity-->>Web: workspace/actor
    Web->>Planning: aggregate + idempotency + precondition
    Planning->>Pg: Lock + re-read + replay/conflict check + write
    alt current or exact replay
        Pg-->>Planning: durable state + opaque revision
        Planning-->>Browser: saved/replayed result
    else stale
        Planning-->>Browser: bounded conflict + current revision
        Browser->>Browser: explicit recheck/resolution
    end
```

Issue #121 is closed completed.

## 5. Reminder flow

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Source
    participant NATS
    participant Notification
    participant Store as Notification PostgreSQL
    participant User
    Source->>NATS: Versioned event
    NATS->>Notification: Deliver/replay
    Notification->>Store: Replay-safe occurrence + expiring claim
    Notification-->>User: Reminder
    Notification->>Store: Immutable/replay-safe outcome
```

## 6. Calendar trusted context and provider sync

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Web
    participant Calendar
    participant Provider
    Web->>Calendar: UUIDv4 workspace + issued-at + HMAC signature
    Calendar->>Calendar: Verify signature/freshness/configured secret
    Calendar->>Provider: Conflict-safe create/update
    Provider-->>Calendar: Bounded response / ETag
    Calendar-->>Web: Credential-free result
```

Legacy client-selected workspace authority is rejected after PR #139. Full hosted per-user credential lifecycle remains `Partial` under #129.

## 7. AI proposal and decision

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant AI
    participant Audit
    User->>Web: Request proposal
    Web->>Identity: Validate session
    Identity-->>Web: actor/workspace
    Web->>AI: Signed bounded context
    AI->>AI: Validate model output as untrusted data
    AI->>Audit: Persist proposal evidence
    AI-->>User: Inert proposal
    User->>AI: Explicit accept/reject
    AI->>Audit: Append decision
```

## 8. Purpose-bound sensitive access

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Caller
    participant Privacy
    participant Audit
    Caller->>Privacy: actor + workspace + resource + purpose + lifetime
    Privacy->>Privacy: Validate scope/policy
    Privacy->>Audit: Append decision/grant evidence
    Privacy-->>Caller: Bounded decision/grant or denial
```

## 9. Data-rights request/status and whole-right completion

### Durable identity foundation

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant Ledger as identity.data_rights_requests
    User->>Web: Export/erase request or status query
    Web->>Identity: Authenticated + recent-authenticated context
    Identity->>Ledger: Begin / tenant-scoped lookup
    Ledger-->>Identity: created/replay/conflict/request state
    Note over Ledger: Terminal receipt evidence is immutable
```

### Cross-domain completion

**Status:** Partial

```mermaid
flowchart LR
    Request --> Registry[Required contributors]
    Registry --> IdentityPart[Identity]
    Registry --> PlanningPart[Planning]
    Registry --> HabitPart[Habit]
    Registry --> ReviewPart[Review]
    Registry --> AiPart[AI audit]
    Registry --> CalendarPart[Calendar]
    Registry --> NotificationPart[Notification]
    IdentityPart --> Reconcile
    PlanningPart --> Reconcile
    HabitPart --> Reconcile
    ReviewPart --> Reconcile
    AiPart --> Reconcile
    CalendarPart --> Reconcile
    NotificationPart --> Reconcile
    Reconcile --> Delivery[Protected export / terminal erasure receipt]
```

Issue #55 owns the incomplete contributor/reconciliation/delivery/retention lifecycle.

## 10. Plugin runtime target

**Status:** Planned

```mermaid
flowchart LR
    Install --> Grant[Capability grant]
    Grant --> Secret[Encrypted secret handle]
    Grant --> Delivery[SSRF-safe delivery]
    Delivery --> Audit[Attempt/outcome audit]
    Grant --> Revoke[Immediate revocation]
```

Issue #130 owns this runtime; current protected main is validation/preparation only.

## 11. Backup and deployment

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Client --> Ingress[Operator-owned ingress/TLS/DNS]
    Ingress --> Web
    Ingress --> Gateway
    Gateway --> Services[Bounded services]
    Services --> Pg[(Operator-owned PostgreSQL)]
    Services --> NATS[(Operator-owned NATS)]
    Services --> Providers[Identity/Calendar/Model providers]
```

Logical backup/restore verifies archive integrity and safe targets; it does not claim PITR. The Kubernetes reference does not provision surrounding platform dependencies.

## 12. Degraded modes

| Failure | Required behavior |
| --- | --- |
| Identity provider unavailable | Existing valid sessions may continue according to session policy; new login degrades explicitly. |
| Model provider unavailable | Core product remains; model path returns bounded unavailability. |
| Calendar provider unavailable | Planning remains usable; sync fails without destructive retry. |
| NATS unavailable | No fabricated delivery success; replay semantics apply after recovery. |
| PostgreSQL unavailable | Durable mutation fails closed; browser draft is not mislabeled durable. |
| Stale write | Return conflict/revision evidence, never silent overwrite. |

## 13. Diagram update rule

When source/migration/API authority changes, update the corresponding protected-main/Partial/Planned status and executable tests before documentation is considered current.