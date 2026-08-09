# LifeOS UML and Interaction Views

**Status:** Accepted architecture  
**Baseline:** protected `main` at `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`

These Mermaid views describe component authority, buyer journeys and failure boundaries. `Implemented on active PR` views are intentionally labeled and do not become protected-main evidence before merge.

## 1. Bounded-context topology

**Status:** Implemented on protected main

```mermaid
flowchart LR
    User[User] --> Web[Next.js Web / PWA]
    Web --> Gateway[Gateway / BFF]
    Gateway --> Identity[Identity service]
    Gateway --> Planning[Planning service]
    Gateway --> Habit[Habit service]
    Gateway --> Review[Review service]
    Gateway --> Notification[Notification service]
    Gateway --> Calendar[Calendar integration]
    Gateway --> AI[AI proposal service]
    Gateway --> Plugin[Plugin integration]
    Gateway --> Privacy[Privacy service]

    Planning -. domain events .-> NATS[(NATS JetStream)]
    Habit -. domain events .-> NATS
    Review -. projection events .-> NATS
    NATS -. reminder/event inputs .-> Notification

    Identity --> IdentityDb[(Identity-owned PostgreSQL)]
    Planning --> PlanningDb[(Planning-owned PostgreSQL)]
    Habit --> HabitDb[(Habit-owned PostgreSQL)]
    Review --> ReviewDb[(Review-owned PostgreSQL)]
    Notification --> NotificationDb[(Notification-owned PostgreSQL)]
    AI --> AiDb[(AI-owned PostgreSQL)]
    Privacy --> PrivacyDb[(Privacy-owned PostgreSQL)]
```

Physical co-location does not create cross-service table authority.

## 2. Login and workspace context

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant Provider as Google/GitHub
    participant Domain as Owning domain service

    User->>Web: Start login
    Web->>Identity: Start bounded OAuth transaction
    Identity->>Provider: Authorization request
    Provider-->>Identity: Callback code/state
    Identity->>Identity: Validate state/provider/redirect
    Identity->>Identity: Resolve user + workspace + authentication instant
    Identity-->>Web: Revocable session cookie
    User->>Web: Domain action
    Web->>Identity: Validate session
    Identity-->>Web: actor/workspace context
    Web->>Domain: Server-derived trusted context + bounded request
    Domain-->>Web: Tenant-scoped result
```

Session rotation may change session issuance but preserves authentication age unless a new authentication ceremony occurs.

## 3. Goal -> Project -> Task / Habit lifecycle

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Goal[Goal] --> Project[Project]
    Project --> Task[Task]
    Goal -. motivates .-> Habit[Habit]
    Project -. may motivate .-> Habit
    Task --> Completion[Task completion evidence]
    Habit --> HabitCompletion[Habit completion evidence]
    Completion --> Review[Daily / weekly review]
    HabitCompletion --> Review
    Review -. projection only .-> PlanningView[Planning recommendations/view]
```

Review is evidence/projection; it does not silently rewrite planning state.

## 4. Today durable synchronization

**Status:** Implemented on active PR

**Evidence:** PR #127, issue #121.

```mermaid
sequenceDiagram
    actor User
    participant Browser as Local Today draft
    participant Web
    participant Identity
    participant Planning
    participant Pg as Planning PostgreSQL

    User->>Browser: Edit local Today plan
    Note over Browser: No automatic upload
    User->>Web: Explicit Save to workspace
    Web->>Identity: Validate session
    Identity-->>Web: actor/workspace
    Web->>Planning: PUT aggregate + idempotency + precondition
    Planning->>Pg: Deterministic workspace/date lock + write
    alt current revision
        Pg-->>Planning: New opaque revision
        Planning-->>Web: Saved
        Web-->>Browser: Replace durable revision only
    else stale revision
        Pg-->>Planning: Conflict + current opaque revision
        Planning-->>Web: Credential-free conflict
        Web-->>Browser: Recheck / explicit resolution required
    end
```

This view is not protected-main behavior until PR #127 merges.

## 5. Reminder flow

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Source as Planning/Habit/Review source
    participant NATS
    participant Notification
    participant Store as Notification PostgreSQL
    participant User

    Source->>NATS: Versioned event
    NATS->>Notification: Deliver/replay
    Notification->>Store: Upsert replay-safe reminder occurrence
    Notification->>Store: Claim with bounded expiry/fencing
    Notification-->>User: In-app reminder
    Notification->>Store: Persist immutable/replay-safe outcome
```

## 6. Calendar synchronization and hosted credential path

### Existing sync adapters

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant LifeOS
    participant Calendar as Calendar integration service
    participant Provider as CalDAV/Google

    LifeOS->>Calendar: Explicit bounded sync request
    Calendar->>Provider: Deterministic create/update + strong precondition where available
    Provider-->>Calendar: Bounded response / ETag
    Calendar-->>LifeOS: Credential-free sync result
```

### Trusted workspace prerequisite

**Status:** Implemented on active PR

**Evidence:** PR #139, issue #129.

```mermaid
sequenceDiagram
    participant Web
    participant Calendar

    Web->>Calendar: workspace UUIDv4 + issued-at + HMAC signature
    Calendar->>Calendar: Verify signature, freshness and configured secret
    alt valid
        Calendar->>Calendar: Derive trusted workspace authority
    else invalid / legacy client header only
        Calendar-->>Web: Fail closed
    end
```

Encrypted per-user credential persistence, OAuth state/PKCE, refresh/revocation and calendar selection remain `Partial` under issue #129.

## 7. AI proposal evidence and decision

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant AI
    participant Audit as AI audit store

    User->>Web: Request proposal
    Web->>Identity: Validate session
    Identity-->>Web: actor/workspace
    Web->>AI: Signed bounded context + request
    AI->>AI: Validate model result as untrusted data
    AI->>Audit: Persist proposal evidence/digest
    AI-->>Web: Inert proposal
    User->>Web: Explicit accept/reject
    Web->>AI: Exact proposal revision/digest + decision
    AI->>Audit: Append decision evidence
```

No arrow grants AI direct planning-table mutation authority.

## 8. Purpose-bound sensitive-data access

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Caller
    participant Privacy
    participant Audit as Privacy evidence store

    Caller->>Privacy: actor + workspace + resource + purpose + requested lifetime
    Privacy->>Privacy: Validate policy and scope
    alt allowed
        Privacy->>Audit: Append decision/grant evidence
        Privacy-->>Caller: Bounded grant/decision
    else denied
        Privacy->>Audit: Append denial evidence where required
        Privacy-->>Caller: Credential-free denial
    end
```

## 9. Data-rights export/erasure lifecycle

### Protected-main foundation

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant Ledger as identity.data_rights_requests

    User->>Web: Export/erasure request
    Web->>Identity: Authenticated request
    Identity->>Identity: Enforce real recent-auth age
    Identity->>Ledger: Begin request with UUIDv4 + idempotency + digest
    Ledger-->>Identity: Created / exact replay / stable conflict
    Note over Ledger: Terminal receipt evidence is immutable
```

### Whole-domain completion

**Status:** Partial

**Tracking:** issue #55.

```mermaid
flowchart LR
    Request[Identity-owned request] --> Registry[Required contributor registry]
    Registry --> IdentityPart[Identity contributor]
    Registry --> PlanningPart[Planning contributor]
    Registry --> HabitPart[Habit contributor]
    Registry --> ReviewPart[Review contributor]
    Registry --> AiPart[AI-audit contributor]
    Registry --> CalendarPart[Calendar contributor]
    Registry --> NotificationPart[Notification contributor]
    IdentityPart --> Reconcile[Durable reconciliation]
    PlanningPart --> Reconcile
    HabitPart --> Reconcile
    ReviewPart --> Reconcile
    AiPart --> Reconcile
    CalendarPart --> Reconcile
    NotificationPart --> Reconcile
    Reconcile --> Delivery[Encrypted export delivery / erasure receipt]
```

Contributor adapters, complete durable reconciliation, protected archive delivery, legal-hold/retention and operator stuck-request recovery remain incomplete.

## 10. Plugin runtime target

**Status:** Planned

**Tracking:** issue #130.

```mermaid
flowchart LR
    User --> Install[Plugin installation request]
    Install --> Grant[Explicit capability grant]
    Grant --> Secret[Encrypted secret handle]
    Grant --> Delivery[SSRF-safe outbound delivery]
    Delivery --> Audit[Bounded attempt/outcome audit]
    Grant --> Revoke[Immediate revocation]
```

The current protected-main plugin surface validates/prepares contracts; it does not imply this runtime exists.

## 11. Backup and restore

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Operator
    participant Backup
    participant Storage
    participant Restore
    participant Pg as PostgreSQL target

    Operator->>Backup: Create logical backup
    Backup->>Storage: Archive + checksum + metadata
    Operator->>Restore: Select archive
    Restore->>Storage: Verify checksum/integrity
    Restore->>Pg: Refuse unsafe non-empty target or restore
    Pg-->>Restore: Restored logical state
```

Logical backup does not claim PITR.

## 12. Deployment topology

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Client --> Ingress[Operator-owned ingress/TLS/DNS]
    Ingress --> Web[LifeOS Web]
    Ingress --> Gateway[LifeOS Gateway]
    Gateway --> Services[Bounded LifeOS services]
    Services --> PgCluster[(Operator-owned PostgreSQL cluster)]
    Services --> NatsCluster[(Operator-owned NATS)]
    Services --> Providers[Identity / Calendar / Model providers]

    Services -. separate DSN / role / schema authority .-> PgCluster
```

The Kubernetes reference does not provision the cluster, PostgreSQL, NATS, DNS/TLS, registry or secret manager.

## 13. Degraded modes

| Failure | Required behavior |
| --- | --- |
| Identity provider unavailable | Existing valid sessions may continue according to session policy; new provider login/link degrades explicitly. |
| Model provider unavailable | Deterministic product behavior remains; proposal/live-conformance path reports bounded unavailability. |
| Calendar provider unavailable | Planning remains usable; sync reports bounded dependency failure without destructive retry. |
| NATS unavailable | Services fail/degrade according to their event durability contract; no fabricated delivery success. |
| PostgreSQL unavailable | Owning durable operation fails closed; browser draft must not be mislabeled as durable. |
| Stale write | Return conflict/revision evidence rather than silently overwrite. |

## 14. Diagram maintenance rule

Every diagram must label protected-main, active-PR, partial or planned behavior. When a service/data/API authority changes, update the owning source/test first and reconcile this file before the change is considered documentation-complete.