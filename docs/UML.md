# LifeOS UML and Interaction Views

**Status:** Implemented on active PR

Sections are protected-main behavior unless explicitly labeled otherwise.

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
    P -. events .-> J[(NATS JetStream)]
    H -. events .-> J
    R -. projections/events .-> J
    J -. reminder/event inputs .-> N
```

Every bounded context retains its own persistence/migration/credential authority.

## Login / workspace authority

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Web
    participant Identity
    participant Provider as Google/GitHub
    User->>Web: begin login
    Web->>Identity: bounded OAuth transaction
    Identity->>Provider: authorization
    Provider-->>Identity: callback
    Identity->>Identity: validate provider/state/redirect
    Identity->>Identity: map user + workspace + authentication instant
    Identity-->>Web: revocable session
```

Session rotation does not manufacture a new authentication ceremony.

## Goal / Project / Task / Habit / Today / Review

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Goal --> Project --> Task
    Goal -. motivates .-> Habit
    Project -. motivates .-> Habit
    Task --> TaskEvidence[Task completion]
    Habit --> HabitEvidence[Habit completion]
    TaskEvidence --> Review
    HabitEvidence --> Review
    Review -. projection only .-> PlanningView[Planning view]
```

```mermaid
stateDiagram-v2
    [*] --> LocalDraft
    LocalDraft --> DurableToday: explicit save + precondition
    DurableToday --> DurableToday: versioned update / exact replay
    DurableToday --> Conflict: stale precondition
    Conflict --> DurableToday: explicit reconcile
    DurableToday --> Completed
    Completed --> [*]
```

## Calendar sync and connection lifecycle

### Workspace-only sync context

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    participant Web
    participant Calendar
    participant Provider
    Web->>Calendar: signed workspace context + bounded sync request
    Calendar->>Calendar: verify signature/freshness/workspace
    Calendar->>Provider: conflict-safe provider operation
    Provider-->>Calendar: bounded response / precondition evidence
    Calendar-->>Web: sanitized result
```

### Connection persistence and local revocation

**Status:** Implemented on protected main

```mermaid
stateDiagram-v2
    [*] --> ConnectionCreated: #150 workspace+user scoped create
    ConnectionCreated --> ConnectionCreated: exact scoped lookup/replay
    ConnectionCreated --> Revoked: #153 atomic tenant+user revoke
    Revoked --> Revoked: exact revocation replay
    Revoked --> [*]
```

Connection metadata carries opaque secret references. Local revocation does not imply provider-side OAuth revocation.

### User-aware hosted authority

**Status:** Implemented on protected main

**Evidence:** PR #155 merged as `7b34a5a584b037653d091ea661ae4627bb5dd2ea`.

```mermaid
sequenceDiagram
    participant Caller
    participant Calendar
    Caller->>Calendar: workspace UUIDv4 + user UUIDv4 + issued-at + HMAC
    Calendar->>Calendar: verify `life-os.calendar-user.v1`, identifiers, signature and freshness
    alt valid
      Calendar-->>Caller: frozen workspace+user authority
    else substituted/stale/future/malformed/unconfigured
      Calendar-->>Caller: fail closed without credential leakage
    end
```

Public disconnect, managed-secret operations, OAuth PKCE/refresh/provider revoke/discovery remain later #129 work.

## AI proposal / decision

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
    Web->>AI: signed bounded context
    AI->>AI: validate untrusted model result
    AI->>Audit: persist inert proposal evidence
    AI-->>User: proposal
    User->>AI: explicit accept/reject bound to exact proposal evidence
    AI->>Audit: append decision
```

## Model-assisted evaluation and development authority

**Status:** Accepted architecture

**Evidence:** ADR 0012, protected-main `AGENTS.md`, and the reviewed live-conformance design.

```mermaid
flowchart LR
    Secret[GitHub Secret NVIDIA_NIM_API_KEY] --> Seed[Approved contextual-orchestrator / credential seeding]
    Seed --> Route[Strong single-route baseline]
    Seed --> Conduct[Bounded conduct cells]
    Route --> Eval[Deterministic LifeOS proposal evaluator]
    Conduct --> Eval
    Eval --> Evidence[Credential-free retained evidence]
    Evidence --> Governance[Governance decision]

    Review[Independent review authority] --> Merge[Merge authority]
    Merge --> Release[Release authority]
    Governance -. evidence only .-> Review
    Seed -. no review/merge/release authority .-> Review
```

Model execution can vary reasoning effort, workflow stages, decomposition, recursion depth, role-specific reasoning effort and access topology only when the exact reviewed dependency exposes those controls. Unsupported cells remain explicit. A conducted result does not self-approve or replace deterministic CI/security/review/merge/release authority.

## Data-rights lifecycle

### Request / status

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Boundary as Identity HTTP boundary
    participant Session
    participant Ledger
    User->>Boundary: request or status query
    Boundary->>Session: validate session / recent-auth as required
    Session-->>Boundary: workspace + user
    Boundary->>Ledger: request ID + workspace + requesting user
    alt owned
      Ledger-->>Boundary: durable state
      Boundary-->>User: bounded no-store lifecycle projection
    else absent/other tenant
      Boundary-->>User: indistinguishable 404
    else invalid/dependency failure
      Boundary-->>User: bounded 400/401/503
    end
```

### Export integrity

**Status:** Implemented on protected main

```mermaid
flowchart LR
    Contributor --> Section[Schema + safe record count + bounded JSON]
    Section --> Normalize[Deterministic UTF-16 property ordering]
    Normalize --> Digest[Section SHA-256]
    Digest --> Manifest[Ordered manifest]
    Manifest --> Whole[Whole-export SHA-256]
```

Complete cross-domain orchestration/delivery remains **Partial** under #55.

## Purpose-bound sensitive access

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

## Plugin installation authority

**Status:** Implemented on protected main

```mermaid
stateDiagram-v2
    [*] --> ValidatedManifest
    ValidatedManifest --> Granted: explicit host capability subset
    Granted --> Granted: exact replay
    Granted --> Conflict: incompatible installation identity reuse
    Granted --> Revoked: explicit revoke
    Revoked --> [*]
    Conflict --> [*]
```

PR #151 protects this authority. Durable plugin installation persistence is active on PR #156; plugin-secret persistence/outbound delivery remain **Partial** under #130.

## Backup / deployment

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Client --> Ingress[Operator-owned ingress/TLS/DNS]
    Ingress --> Web
    Web --> Services[Independent LifeOS services]
    Services --> Pg[(Service-owned PostgreSQL authority)]
    Services <--> NATS[(NATS JetStream)]
    Services --> Providers[Identity / Calendar / Model / Plugin endpoints]
```

Logical backup/restore verifies integrity and safe targets; it does not claim PITR or managed surrounding infrastructure.

## Verification evidence state

**Status:** Implemented on protected main

**Evidence:** ADR 0010 and PR #154 merged as `2c272a404f8f3a74aa5796a1957d4a6ce0fabe8f`; #147 is Superseded.

```mermaid
flowchart LR
    Source[source_head_sha] --> SourceCheck[Exact source verification]
    BaseSnapshot[pr_base_snapshot_sha] --> Metadata[Historical PR snapshot]
    LiveBase[live_base_tip_sha] --> MergeDecision[Current base-sensitive decision]
    Source --> Integration[integration_tree_sha]
    LiveBase --> Integration
    Integration --> MergeCheck[Compatibility evidence]
    SourceCheck --> Gate
    MergeCheck --> Gate
    MergeDecision --> Gate
    Gate --> Main[protected_main_sha]
    Main --> Release[release_source_sha]
```

No green result transfers authority across identities. Protected PR #154 reconstructs compatibility from the independently resolved current source and live base. Issue #132 remains open only for residual central SAST/Security scanner checkout and attribution classification; current central Semgrep synthetic-merge evidence must not be relabeled exact-source evidence.

## Degraded modes

**Status:** Accepted architecture

| Failure | Required behavior |
| --- | --- |
| Identity/calendar/model provider unavailable | Bounded dependency failure; unrelated product domains remain usable where safe |
| Owning PostgreSQL unavailable | Durable mutation fails closed; browser draft is not mislabeled durable |
| NATS unavailable | No fabricated delivery success; replay/recovery semantics apply |
| Stale write | Explicit conflict/revision evidence, never silent overwrite |
| Malformed/forged internal context | Fail closed without reflecting secrets or untrusted identifiers |
| Unknown/stale verification identity | Evidence unavailable/non-passing rather than promoted success |
