# LifeOS Product Requirements Document

**Version:** 1.0-draft  
**Baseline:** protected `main` at `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`  
**Product:** LifeOS  
**Repository:** `ContextualWisdomLab/life-os`

## 1. Product definition

LifeOS is an open-source, privacy-first personal operating system that connects long-term goals to projects, tasks, habits, Today planning, calendar commitments, reviews, data rights, and auditable AI assistance. It is a multi-user, server-backed and self-hostable product composed from independently bounded services.

LifeOS is not a flat checklist and its AI is not an autonomous owner of user state. The product promise is:

> Turn intentions into an explainable, recoverable action loop while the user remains authoritative over personal data and AI-assisted decisions.

## 2. Canonical status vocabulary

Requirement status is exactly one of:

- `Implemented on protected main`
- `Implemented on active PR`
- `Partial`
- `Accepted architecture`
- `Planned`
- `Research only`
- `Superseded`
- `Out of scope`

Qualifiers, issue numbers and PR numbers belong in evidence, never inside the status value. Protected-main source, migrations and tests outrank prose when claims disagree.

## 3. Product evolution

The repository retains earlier design choices as history, not parallel current truth.

| Decision | Current status | Canonical interpretation |
| --- | --- | --- |
| Login-free browser-only local-first product | Superseded | Local storage remains useful for drafts/offline UX, but durable state belongs to authenticated server-side services. |
| Private personal-only repository | Superseded | The product is an open-source multi-user/self-hostable platform; real personal data is never committed. |
| Single application / single-Docker primary architecture | Superseded | Compose remains a deployment profile; durable architecture is domain-oriented modular MSA. |
| UUIDv7 internal identifiers | Superseded | Protected main uses opaque UUIDv4 internal identifiers. |
| Google + GitHub authentication, own backend, PostgreSQL, Next.js/PWA | Implemented on protected main | These are current product/runtime boundaries. |

## 4. Users and jobs

### Individuals

- connect goals to executable projects, tasks and habits;
- decide what matters Today without losing longer-term context;
- resume safely across devices;
- review progress and stalled work;
- use calendar and AI assistance without silently surrendering authority;
- export or erase their data through an auditable lifecycle.

### Self-hosters and platform operators

- deploy reproducibly with explicit external dependencies;
- understand service/data ownership;
- rotate credentials and recover from failure;
- inspect security, privacy, backup and release evidence.

### Integration developers

- build against versioned APIs/events/plugin contracts;
- receive only explicitly granted capabilities;
- avoid direct cross-service database authority.

## 5. Product principles

1. **Goal-connected action.** Tasks and habits retain traceable purpose where relevant.
2. **User authority.** AI output is inert until an explicit product/user decision accepts it.
3. **Durable ownership.** Domain services own authoritative state; browser state is explicitly draft/cache/offline state.
4. **Tenant safety.** User/workspace authority is derived from trusted authentication context.
5. **Modular MSA.** Each bounded context owns persistence, migrations, credentials, tests and failure behavior.
6. **Recoverability.** Replay, stale writes, retries, backup/restore and migration failure are first-class product contracts.
7. **Privacy by purpose.** Sensitive data is controlled by actor, workspace, purpose, lifetime and audit evidence rather than blanket masking.
8. **Evidence over maturity slogans.** Capability maturity and buyer-gap exhaustion are separate evidence dimensions.
9. **Accessibility and localization.** Core interaction is keyboard-accessible and Korean/English capable.
10. **Standalone plus composable.** Optional CWL integrations must not make LifeOS unusable independently.

## 6. Primary buyer journey

1. Authenticate with Google or GitHub.
2. Enter an authorized personal workspace.
3. Capture an action or intention quickly.
4. Organize durable Goals -> Projects -> Tasks and recurring Habits.
5. Select bounded Today priorities and schedules.
6. Complete work with replay-safe evidence.
7. Receive bounded reminders.
8. Perform daily/weekly review against durable evidence.
9. Synchronize selected commitments with an authorized calendar connection.
10. Optionally request an auditable AI proposal.
11. Inspect proposal evidence and explicitly accept or reject it.
12. Export or erase user data through recent-authenticated, durable, auditable orchestration.
13. Resume on another device without stale overwrite.
14. Recover through supported backup/restore and operator runbooks.

A release is evaluated against this journey, not service count.

## 7. Functional requirements

### Identity and workspace

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-ID-001 | Google and GitHub login through bounded OAuth/OIDC contracts. | Implemented on protected main | Identity OAuth/session source and integration tests. |
| PRD-ID-002 | Revocable workspace-scoped browser sessions. | Implemented on protected main | Identity session repositories/runtime. |
| PRD-ID-003 | Opaque UUIDv4 internal identifiers. | Implemented on protected main | `ARCHITECTURE.md`, migrations and validators. |
| PRD-ID-004 | Derive tenant authority from authenticated context, not arbitrary client ownership fields. | Implemented on protected main | Cross-tenant identity/planning/AI/privacy tests. |
| PRD-ID-005 | Preserve authentication age separately from session rotation. | Implemented on protected main | #134-#137 protected-main slices. |

### Goals, projects, tasks and Today

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-PLAN-001 | Persist goals, projects and tasks across restarts. | Implemented on protected main | Planning PostgreSQL repository/integration tests. |
| PRD-PLAN-002 | Tenant-safe bounded planning search. | Implemented on protected main | Planning search source and web tests. |
| PRD-PLAN-003 | Keep browser-local quick capture/drafts distinct from durable records. | Implemented on protected main | Web capture/Today behavior. |
| PRD-PLAN-004 | Provide a bounded Today action loop. | Implemented on protected main | Current Today UI/composition tests. |
| PRD-PLAN-005 | Move Today state explicitly to workspace durability and reconcile stale multi-device edits. | Implemented on active PR | Issue #121, PR #127 at its current live head. Not protected-main evidence until merge. |

### Habits and reviews

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-HAB-001 | Recurring habit definitions with durable completion history. | Implemented on protected main | Habit domain/PostgreSQL tests. |
| PRD-HAB-002 | Replay-safe tenant-scoped habit completion. | Implemented on protected main | Habit integration tests. |
| PRD-REV-001 | Guided daily/weekly review over durable evidence. | Implemented on protected main | Review service and integration tests. |
| PRD-REV-002 | Review projections never silently mutate source planning state. | Implemented on protected main | Service authority boundary. |

### Calendar and reminders

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-CAL-001 | Conflict-safe CalDAV/Google synchronization with deterministic identifiers/preconditions. | Implemented on protected main | Calendar provider adapters/tests. |
| PRD-CAL-002 | Hosted per-user encrypted credential storage, refresh, revocation and calendar selection. | Partial | Issue #129 remains open. |
| PRD-CAL-003 | Stop accepting client-selected workspace authority at the calendar boundary. | Implemented on active PR | PR #139 is the bounded trusted-context prerequisite for #129. |
| PRD-NOT-001 | Timezone-correct bounded reminders with retry/fatigue controls. | Implemented on protected main | Notification persistence/scheduler tests. |

### AI assistance

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-AI-001 | Treat model output as an inert proposal. | Implemented on protected main | AI proposal/audit architecture and tests. |
| PRD-AI-002 | Persist proposal evidence and replay-safe accept/reject decisions. | Implemented on protected main | AI audit persistence/API. |
| PRD-AI-003 | Keep deterministic proposal-quality gates independent of live-provider availability. | Implemented on protected main | Quality evaluator plus bounded NIM conformance. |
| PRD-AI-004 | Use stronger orchestration only when measured evidence beats a strong single-route baseline without safety regression. | Accepted architecture | `ARCHITECTURE.md` and conformance harness. |
| PRD-AI-005 | Model-assisted repository development never becomes product-data or merge authority. | Implemented on protected main | OpenCode/NVIDIA development loop and hardening. |

### Privacy and data rights

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-PRIV-001 | Purpose-bound sensitive-data access with bounded grants and auditable evidence. | Implemented on protected main | Privacy service. |
| PRD-PRIV-002 | Preserve real authentication age and enforce recent authentication for data-rights operations. | Implemented on protected main | #134-#137 integrated on main. |
| PRD-PRIV-003 | Persist durable data-rights request state and immutable terminal receipt evidence. | Implemented on protected main | #138, migration `0006_data_rights_request_ledger.sql`, ledger tests. |
| PRD-PRIV-004 | Complete export/erasure orchestration across every domain, delivery, retention/legal-hold and reconciliation lifecycle. | Partial | Issue #55 remains canonical buyer gap. |

### Plugins and extensibility

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-INT-001 | Versioned plugin manifest/event contract without direct database authority. | Implemented on protected main | Plugin SDK/integration service. |
| PRD-INT-002 | Installation grants, encrypted secrets, SSRF-safe outbound delivery, retry/audit and revocation. | Planned | Issue #130. |
| PRD-INT-003 | Preserve optional CWL integration without making LifeOS dependent on another repository's private data store. | Accepted architecture | Service/interface boundary. |

### Web, PWA, accessibility and localization

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-WEB-001 | Responsive installable PWA. | Implemented on protected main | PWA/browser tests. |
| PRD-WEB-002 | Keyboard operability, visible focus and non-color-only essential state. | Implemented on protected main | Accessibility tests for current core journeys. |
| PRD-WEB-003 | Structurally complete Korean/English catalogs. | Implemented on protected main | Message catalog tests. |
| PRD-WEB-004 | Explicit reconnect/conflict experience for durable Today drafts. | Implemented on active PR | PR #127 bounded Today journey. |

### Governance and readiness

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-GOV-001 | Report capability maturity separately from canonical buyer-gap exhaustion. | Implemented on protected main | Current commercial-readiness issue #21 reports 22/22 maturity and four unresolved canonical buyer gaps separately. |
| PRD-GOV-002 | Bind trusted evidence to repository provenance and exact commit identity. | Implemented on protected main | #135 and readiness source. |
| PRD-GOV-003 | Distinguish exact contributor-head verification from synthetic merge-tree compatibility evidence. | Planned | Issue #132. |

## 8. Non-functional requirements

### Security and privacy

- Fail closed on malformed ownership, identifiers, signatures, digests, timestamps and provider responses.
- Parameterize SQL and keep service credentials isolated.
- Bound untrusted network/file/model/provider inputs by schema, size and time.
- Keep credentials, raw model text/hidden reasoning and unbounded tenant content out of retained public artifacts.

### Reliability

- Replayable mutations use idempotency identities.
- Loss-prone concurrent mutations use explicit revision/digest/ETag/fencing evidence.
- Durable workers have bounded retries and sanitized terminal states.
- Cross-service consumers are idempotent under replay where at-least-once delivery exists.

### Quality

- Public production declarations are beginner-readable.
- Packages declaring exact coverage gates maintain meaningful 100% statement/branch/function/line coverage.
- Core buyer journeys use real PostgreSQL/browser evidence where persistence/UI semantics matter.
- Documentation claims are machine-checked against code/migrations where feasible.

### Operability

- Operator-owned infrastructure and upstream-provided software are clearly separated.
- Public diagnostics remain credential-free.
- Release claims require one exact integrated protected head.

## 9. Non-goals

LifeOS does not claim medical/psychological diagnosis, autonomous consequential decisions, silent AI mutation, provider availability guarantees, direct cross-service database writes, certifications without external evidence, or fixed public SLA/RPO/RTO values without measured deployment evidence.

## 10. Stable-release outcome

The first stable release requires one protected integrated head where the primary journey, canonical buyer-gap state, tenant/privacy boundaries, migrations, backup/restore, deployment, accessibility/localization, packaging/SBOM/provenance, required security checks and actual review policy pass together. A merged feature or documentation PR alone is not a release.