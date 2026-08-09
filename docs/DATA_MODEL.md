# LifeOS Logical Data Model and ERD

**Baseline:** protected `main` at `876850018a17323900844e79845ba395b7bf6a9a`

## 1. Scope and authority

This is a **logical cross-service model**, not one physical shared database schema. LifeOS services own their persistence independently. Relationships drawn across service boundaries mean application/API/event relationships only; they do **not** authorize cross-service SQL joins, foreign keys, reads, or writes.

Entity labels use:

- **Persisted** — protected-main persistence or migration/repository evidence exists.
- **Logical** — product/domain relationship, but the exact physical table may differ or remain planned.
- **Projection** — derived/read-optimized state; not source-of-truth mutation authority.
- **Planned** — accepted or tracked product concept without protected-main persistence evidence.

Internal IDs use opaque UUIDv4 under the current repository contract.

## 2. Bounded-context ownership

| Bounded context | Logical entities | Persistence status |
| --- | --- | --- |
| Identity | user account, external identity, browser session, workspace, workspace membership | Persisted / partially named by service migrations |
| Planning | goal, project, task, durable planning/search/Today-related state | Goal/project/task persisted; complete durable Today aggregate is Partial |
| Planning future extensions | milestone, task dependency | Planned/logical only on this baseline; not represented as protected-main Planning tables |
| Habit | habit definition, recurrence state, completion event | Persisted |
| Review | daily/weekly review snapshot, review observation | Persisted/projection depending on type |
| Calendar integration | provider connection/sync record/resource binding | Partial; provider adapters implemented, hosted per-user credential lifecycle incomplete |
| Notification | reminder occurrence, worker claim, delivery outcome, inbox message | Persisted |
| AI proposal | proposal evidence, proposal decision event, model provenance | Persisted |
| Privacy access | access decision, access grant, access event | Persisted |
| Plugin integration | plugin manifest/contract/event preparation | Logical/runtime contract; installation and durable plugin secret state are not claimed |
| Audit/operations | correlation/provenance/backup/deployment evidence | Distributed across owning services/artifacts rather than a single shared DB |

Protected-main Planning migrations currently create only `planning.goals`, `planning.projects`, and `planning.tasks` as the core hierarchy. This document therefore does not present milestones or task dependencies as persisted current entities.

## 3. Protected-main logical ERD

```mermaid
erDiagram
    USER_ACCOUNT ||--o{ EXTERNAL_IDENTITY : links
    USER_ACCOUNT ||--o{ BROWSER_SESSION : owns
    USER_ACCOUNT ||--o{ WORKSPACE_MEMBERSHIP : receives
    WORKSPACE ||--o{ WORKSPACE_MEMBERSHIP : authorizes

    WORKSPACE ||--o{ GOAL_RECORD : contains
    WORKSPACE ||--o{ PROJECT_RECORD : contains
    GOAL_RECORD ||--o{ PROJECT_RECORD : owns
    WORKSPACE ||--o{ TASK_RECORD : contains
    PROJECT_RECORD ||--o{ TASK_RECORD : owns

    WORKSPACE ||--o{ HABIT_RECORD : contains
    HABIT_RECORD ||--o{ HABIT_COMPLETION_EVENT : records

    WORKSPACE ||--o{ REVIEW_SNAPSHOT : summarizes
    REVIEW_SNAPSHOT ||--o{ REVIEW_OBSERVATION : contains

    WORKSPACE ||--o{ REMINDER_OCCURRENCE : schedules
    REMINDER_OCCURRENCE ||--o{ REMINDER_CLAIM : claimed_by
    REMINDER_OCCURRENCE ||--o{ REMINDER_OUTCOME : produces
    REMINDER_OCCURRENCE ||--o| INBOX_MESSAGE : may_deliver

    WORKSPACE ||--o{ CALENDAR_CONNECTION : authorizes
    CALENDAR_CONNECTION ||--o{ CALENDAR_RESOURCE_BINDING : synchronizes

    WORKSPACE ||--o{ AI_PROPOSAL_RECORD : receives
    AI_PROPOSAL_RECORD ||--o{ AI_PROPOSAL_DECISION : decides

    WORKSPACE ||--o{ PRIVACY_ACCESS_DECISION : governs
    PRIVACY_ACCESS_DECISION ||--o{ PRIVACY_ACCESS_GRANT : may_issue
    PRIVACY_ACCESS_GRANT ||--o{ PRIVACY_ACCESS_EVENT : consumed_as
```

`GOAL_RECORD` → `PROJECT_RECORD` → `TASK_RECORD` reflects the current Planning migration contract: one project references one goal in the same workspace, and one task references one project in the same workspace.

## 4. Planned Planning extension model

Milestones and task dependencies appeared in earlier product planning but are not current protected-main Planning tables. If task dependencies are implemented, a dependency record must connect **exactly one predecessor task and exactly one successor task**, while either task may participate in many dependency records:

```mermaid
erDiagram
    TASK_RECORD ||--o{ TASK_DEPENDENCY : predecessor
    TASK_RECORD ||--o{ TASK_DEPENDENCY : successor
```

A future migration must define cycle/self-dependency policy, workspace-safe composite references, deletion behavior, indexing, concurrency semantics, and realistic PostgreSQL tests before this section can be promoted from `Planned` to `Persisted`.

## 5. Identity and workspace

### `user_account` — logical/persisted

Represents the LifeOS user independent of any provider-specific account identifier.

Minimum logical attributes:

- `user_account_id` — UUIDv4
- display/profile fields owned by identity-service
- lifecycle timestamps/state according to the service implementation

### `external_identity` — logical/persisted

Maps Google/GitHub or another explicitly supported identity provider to `user_account`. Provider identifiers are external metadata and never reused as LifeOS primary keys.

### `browser_session` — persisted

Revocable authenticated session bound to a LifeOS user/workspace authorization context. Secret/token material is represented by digests or protected server-side values according to the identity-service contract, not exposed to downstream services.

### `workspace` / `workspace_membership` — logical/persisted

A workspace is the tenant/data-ownership boundary. A membership binds a user to workspace authority. Personal workspaces are the current primary UX; future team UI does not change the requirement that every domain operation be tenant scoped.

## 6. Planning model

### `goal_record` — persisted

Longer-term objective. Current protected-main Planning persistence stores the goal as the top level of the implemented Goal → Project → Task hierarchy.

### `project_record` — persisted

Finite coordinated outcome/action set. The current Planning migration requires exactly one `goal_id` in the same workspace for each persisted project.

### `task_record` — persisted

Actionable planning item. The current Planning migration requires exactly one `project_id` in the same workspace for each persisted task. Completion and stale-update semantics are defined by planning-service.

### `milestone_record` — planned/logical

Historical product planning included milestones, but protected-main Planning migrations at this baseline do not create a milestone table. Do not treat milestones as durable current behavior until a reviewed migration/domain/API/test slice implements them.

### `task_dependency` — planned/logical

Historical product planning included directed task dependencies. Protected-main Planning migrations at this baseline do not create a task-dependency table. The intended logical shape is one predecessor + one successor per dependency record as shown above, but no persistence/API claim is made yet.

### Durable Today state — partial

Protected main has durable planning objects and a Today action loop, but complete cross-device optimistic-concurrency handling for the whole Today aggregate remains issue #121. Browser-local drafts are not equivalent to this durable aggregate.

## 7. Habit and completion model

### `habit_record` — persisted

Recurring behavior definition owned by habit-service.

### `habit_completion_event` — persisted, immutable evidence

Records an accepted completion with workspace/habit/idempotency identity. Current integration tests exercise duplicate/concurrent completion protection and append-only history behavior.

A recurrence-definition edit must not rewrite historical completion evidence.

## 8. Review model

### `review_snapshot` — persisted/projection

Daily/weekly review state derived from authorized planning/habit evidence. Review-service owns the projection and may persist it, but the snapshot is not authorized to rewrite source planning/habit tables.

### `review_observation` — logical/persisted as defined by current review service

Bounded observation recorded during a review ritual.

## 9. Notification model

### `reminder_occurrence` — persisted

One due reminder instance, including tenant/time semantics.

### `reminder_claim` — persisted/ephemeral durable coordination

Expiring/fenced worker authority for one processing attempt. Claims must be recoverable after expiry and must not turn into duplicate delivery authority.

### `reminder_outcome` — persisted immutable evidence

Delivery/defer/failure evidence. Current database tests explicitly exercise immutability behavior.

### `inbox_message` — persisted

Idempotent in-app delivery artifact where the current notification runtime uses it.

## 10. Calendar integration model

### `calendar_connection` — logical/partial

Represents a user/workspace authorization to a provider. Protected-main provider adapters exist, but issue #129 tracks the missing hosted per-user encrypted credential/refresh/revocation/provider-selection lifecycle. The exact physical connection table is not claimed until that slice lands.

### `calendar_resource_binding` — logical

Relates a LifeOS scheduling object to a remote calendar resource/ETag/deterministic provider identifier. Exact physical storage must follow the calendar service implementation and must not be invented from this logical model.

## 11. AI proposal model

### `ai_proposal_record` — persisted immutable proposal evidence

Contains bounded proposal content/evidence/provenance and ownership context. Proposal output is inert.

### `ai_proposal_decision` — persisted append-only decision event

Binds explicit accept/reject to exact proposal revision/content digest, actor, workspace, idempotency identity and decision time. A decision event is evidence; it is not a generic command bus.

## 12. Privacy access model

### `privacy_access_decision` — persisted append-only evidence

Records whether a purpose/resource/actor request is authorized/denied under the privacy-service policy.

### `privacy_access_grant` — persisted bounded grant

Represents a signed/time-bounded/single-use authorization where required by the service contract. Deletion/arbitrary mutation is prohibited by current persistence controls.

### `privacy_access_event` — persisted append-only evidence

Records governed use/consumption of access authority. It contains bounded audit facts, not a copy of every sensitive payload.

## 13. Cross-service relationship rules

1. Shared `workspace_id`/`actor_id` values are logical correlation identifiers, not permission to query another service database.
2. Cross-service mutation uses HTTP/event/saga/plugin/MCP contracts.
3. A service receiving a shared identifier still validates the authenticated/signed authority relevant to that request.
4. Derived projections may cache foreign-domain identifiers/evidence but cannot become source-of-truth mutation authority.
5. Provider-native IDs remain at provider adapter boundaries.
6. Audit/provenance records store the minimum bounded evidence needed to reconstruct authority/outcome without retaining secrets or unnecessary personal content.

## 14. Version and temporal requirements

Where the domain can lose data under concurrency, records/commands expose an explicit revision, digest, ETag, idempotency key, immutable event ID, or equivalent concurrency identity.

Time fields distinguish:

- event/decision/completion occurrence time when relevant;
- persistence/recording time where needed for audit;
- local calendar date/timezone where reminder/habit behavior depends on a user's civil time.

This document does not prescribe one global bitemporal schema because protected-main transactional services do not currently share such a requirement.

## 15. Physical-model rule

Before adding a logical/planned entity to a migration:

- identify the owning bounded service;
- use a descriptive multiword `snake_case` object name;
- define tenant/index/constraint/idempotency/concurrency semantics;
- add migration and rollback/forward-fix evidence;
- add realistic PostgreSQL integration tests;
- update this document only after physical names and status are verified.
