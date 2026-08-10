# LifeOS API and Event Contract Registry

**Status:** Accepted architecture  
**Baseline:** protected `main` at `dcc787f77b708cecda054b47d6f7d7b561575a67`

Exact payload shapes remain authoritative in owning source packages/controllers/schemas/tests. This registry records ownership, maturity and cross-cutting semantics.

## 1. Contract rules

- Breaking semantics require an explicit version or reviewed migration path.
- Client-selected actor/workspace values are never tenant authority.
- Replayable mutations use idempotency identity where duplicate side effects are plausible.
- Lost-update-sensitive mutations use revision/digest/ETag/preconditions.
- Public/internal errors are bounded and credential-free.
- Provider/model/plugin/event input is untrusted until validated.
- Events never grant direct producer-database authority.

## 2. HTTP ownership registry

| Boundary | Owner | Status | Evidence / gap |
| --- | --- | --- | --- |
| OAuth/login/session/workspace context | Identity | Implemented on protected main | Google/GitHub OAuth and session tests. |
| Authentication age / recent-auth policy | Identity | Implemented on protected main | #134-#137. |
| Planning goals/projects/tasks/search | Planning | Implemented on protected main | Planning repository/API/search tests. |
| Durable Today aggregate | Planning | Implemented on protected main | PR #127 / issue #121 closed. |
| Habit definition/completion | Habit | Implemented on protected main | Habit tests. |
| Guided review | Review | Implemented on protected main | Review service tests. |
| Reminder/inbox | Notification | Implemented on protected main | Notification persistence/runtime tests. |
| Calendar synchronization | Calendar integration | Implemented on protected main | Conflict-safe CalDAV/Google adapters. |
| Calendar trusted workspace context | Calendar integration | Implemented on protected main | PR #139 merged as `eb4ff993a6c8f948377d68d186130c149f370154`. |
| Hosted per-user calendar credentials | Calendar integration | Partial | Issue #129. |
| AI proposal/evidence/decision | AI | Implemented on protected main | Inert proposal/audit tests. |
| Purpose-bound sensitive access | Privacy | Implemented on protected main | Privacy service tests. |
| Data-rights request/receipt ledger | Identity | Implemented on protected main | #138. |
| Tenant/requester-scoped data-rights request lookup | Identity | Implemented on protected main | PR #144 merged as `dcc787f77b708cecda054b47d6f7d7b561575a67`. |
| Whole-product export/erasure orchestration | Identity coordinator + contributors | Partial | Issue #55. |
| Plugin contract discovery/validation/preparation | Plugin integration | Implemented on protected main | Plugin SDK/service tests. |
| Plugin install/secret/outbound runtime | Plugin integration | Planned | Issue #130. |

## 3. Selected mutation semantics

### Durable Today

**Status:** Implemented on protected main

- aggregate scoped to authenticated workspace + local date;
- explicit create/update preconditions;
- opaque revision/idempotency identity;
- deterministic transaction-scoped lock ordering and fresh post-lock checks;
- exact replay returns original outcome;
- conflicting key reuse/stale revision fails with bounded conflict evidence;
- browser draft migrates only after explicit user action.

### Data-rights request/status

**Status:** Implemented on protected main

- request/idempotency IDs are UUIDv4;
- request kind/status are bounded;
- durable evidence stores digests/status/timestamps rather than export payloads;
- incompatible request-ID/idempotency reuse maps to stable domain conflict;
- terminal receipt is immutable;
- tenant-scoped request lookup requires request ID + workspace ID + requesting user ID and returns inaccessible state without disclosing another tenant's request.

### Calendar trusted context

**Status:** Implemented on protected main

The calendar HTTP boundary requires a fresh HMAC-bound UUIDv4 workspace context and rejects unsigned/forged/stale/future/malformed context or missing verifier configuration. A legacy `x-workspace-id` header cannot grant tenant authority.

## 4. Event registry

| Event class | Producer | Consumer examples | Status |
| --- | --- | --- | --- |
| Planning domain events | Planning | Notification/review/integration projections | Implemented on protected main |
| Habit events | Habit | Notification/review projections | Implemented on protected main |
| Review projection events | Review | Notification/analytics surfaces as implemented | Implemented on protected main |
| Plugin CloudEvents-style envelope | Plugin SDK/integration | Prepared external delivery | Implemented on protected main |
| Plugin outbound runtime delivery | Plugin runtime | Authorized external origin | Planned |

Event type/version and bounded tenant/correlation identity are explicit; replay-safe consumers are required when at-least-once delivery applies.

## 5. Error classes

Where relevant, public boundaries distinguish validation, unauthenticated, unauthorized/purpose denied, tenant-safe not found, conflict/stale/idempotency reuse, rate limit/backpressure, dependency unavailable and unexpected failure. Errors never expose SQL, stack traces, credentials, raw provider/model bodies or private infrastructure URLs.

## 6. Contract-change procedure

1. Add a failing contract/integration test.
2. Update owning source/schema and consumers.
3. Verify exact contributor-head source behavior and required merge-tree compatibility separately.
4. Reconcile PRD/TRD/Architecture/Data Model/UML/Threat/Privacy/Operability when authority changes.
5. Keep active-PR behavior labeled until protected-main integration.
6. Update `CHANGELOG.md` for buyer/operator-visible behavior.