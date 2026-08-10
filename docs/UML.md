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
    LocalDraft --> DurableToday: explicit save + precondition
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

## Calendar connection registry foundation

**Status:** Implemented on protected main

**Evidence:** PR #150 merged as `1623df364925f84920c07c112f1ae96777277d20`; full hosted credential lifecycle remains `Partial` under issue #129.

```mermaid
sequenceDiagram
    participant Caller
    participant Calendar
    participant Repo as Calendar connection repository
    participant Pg as Calendar-owned PostgreSQL

    Caller->>Calendar: trusted workspace + user + provider/account/calendar metadata + opaque credential references
    Calendar->>Calendar: validate UUIDv4 authority, provider and normalized scopes
    Calendar->>Repo: create / scoped lookup
    Repo->>Pg: fixed parameterized SQL
    alt valid unique evidence
        Pg-->>Repo: one workspace+user scoped connection record
        Repo-->>Calendar: immutable bounded record
    else malformed input or duplicate persisted evidence
        Repo-->>Calendar: fail closed
    end
```

The protected migration/repository is a persistence foundation only; OAuth callback state, managed secret storage, refresh/revocation and discovery/selection remain separate issue #129 work.

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

## Data-rights request and status lifecycle

**Status:** Implemented on protected main

```mermaid
sequenceDiagram
    actor User
    participant Identity as Identity HTTP boundary
    participant Session as Session introspection
    participant Ledger as identity.data_rights_requests

    User->>Identity: create or query data-rights request
    Identity->>Session: validate session + recent-auth provenance where required
    Session-->>Identity: userId + workspaceId
    Identity->>Ledger: tenant+actor scoped request operation
    alt owned request
        Ledger-->>Identity: durable request
        Identity-->>User: bounded public lifecycle + no-store
    else absent or other tenant
        Ledger-->>Identity: undefined
        Identity-->>User: indistinguishable 404 + no-store
    else malformed / unauthenticated / dependency failure
        Identity-->>User: bounded 400 / 401 / 503 + no-store
    end
```

PR #146 is protected-main evidence for the authenticated public status resource. Complete cross-domain export/deletion remains `Partial` under issue #55.

## Tenant export integrity flow

**Status:** Implemented on protected main

**Evidence:** PR #149.

```mermaid
flowchart LR
    C[Domain contributor] --> S[Schema version + safe record count + bounded JSON]
    S --> N[Deterministic normalization / UTF-16 key ordering]
    N --> D[Section SHA-256]
    D --> M[Ordered export manifest]
    M --> W[Whole-export SHA-256]
```

Integrity digests do not grant access authority, confidentiality, provenance or signature identity.

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

## Plugin installation authority

**Status:** Implemented on active PR

**Evidence:** PR #151; full runtime remains incomplete under issue #130.

```mermaid
stateDiagram-v2
    [*] --> ValidatedManifest
    ValidatedManifest --> GrantedInstallation: explicit host capability subset
    GrantedInstallation --> GrantedInstallation: exact replay
    GrantedInstallation --> Conflict: incompatible installation-id reuse
    GrantedInstallation --> Revoked: explicit revocation
    Revoked --> [*]
    Conflict --> [*]
```

A manifest requests capabilities but does not grant them. This active application authority does not imply durable plugin-secret or outbound-delivery persistence exists.

## Backup / restore and deployment

**Status:** Implemented on protected main

```mermaid
flowchart TB
    Ingress[Ingress / TLS] --> Web[Web/BFF]
    Web --> Services[Independent LifeOS services]
    Services --> Pg[(Service-owned PostgreSQL authority)]
    Services <--> NATS[(NATS JetStream)]
    Operator[Operator secret manager / network policy / backups / monitoring] -. configures .-> Services
```

Logical backup/restore verifies integrity and unsafe-target refusal; it does not claim PITR or managed infrastructure ownership.

## Verification evidence identity

**Status:** Implemented on active PR

**Evidence:** ADR 0010 and PR #147.

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

No green status is silently transferred across evidence identities. Issue #132 remains open until PR #147 integrates and residual required-workflow attribution is reconciled.

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
