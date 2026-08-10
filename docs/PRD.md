# LifeOS Product Requirements Document

**Version:** 1.0-draft  
**Baseline:** protected `main` at `dcc787f77b708cecda054b47d6f7d7b561575a67`  
**Product:** LifeOS

## 1. Product definition

LifeOS is an open-source, privacy-first personal operating system that connects long-term goals to projects, tasks, habits, Today planning, calendar commitments, reviews, data rights, and auditable AI assistance. It is a multi-user, server-backed and self-hostable product composed from independently bounded services.

> Turn intentions into an explainable, recoverable action loop while the user remains authoritative over personal data and AI-assisted decisions.

## 2. Canonical status vocabulary

Every requirement uses exactly one of: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, `Out of scope`. Qualifiers and PR/issue evidence belong outside the status value.

## 3. Historical evolution

| Earlier choice | Status | Current interpretation |
| --- | --- | --- |
| Login-free browser-only local-first primary product | Superseded | Local state remains useful for drafts/offline UX; durable state is server-owned. |
| Private personal-only repository | Superseded | LifeOS is an open-source, multi-user/self-hostable product; real personal data is never source data. |
| Single application / single-Docker primary architecture | Superseded | Compose remains a deployment profile; the durable architecture is domain-oriented MSA. |
| UUIDv7 internal identifiers | Superseded | Protected main uses opaque UUIDv4 internal identifiers. |
| Google + GitHub authentication, owned backend, PostgreSQL, Next.js/PWA | Implemented on protected main | Current product/runtime boundary. |

## 4. Primary users

- Individuals connecting goals, projects, tasks, habits and reviews.
- Knowledge workers needing safe Today planning and cross-device durability.
- Self-hosters and platform operators requiring auditable deployment/recovery/security boundaries.
- Integration developers building against versioned APIs/events/plugin contracts.

## 5. Product principles

1. Goal-connected action.
2. User authority over AI-assisted decisions.
3. Domain-service durable ownership; browser-local data is explicitly draft/cache/offline state.
4. Tenant authority derived from authenticated/signed context, never attacker-selected headers.
5. Modular MSA with service-owned persistence/migrations/credentials.
6. Replay, concurrency, backup/restore and migration failure are product contracts.
7. Sensitive access is purpose-bound and auditable.
8. Capability maturity and buyer-gap exhaustion are distinct evidence dimensions.
9. Core UX is accessible and Korean/English capable.
10. Optional CWL integrations preserve standalone LifeOS operation.

## 6. Primary buyer journey

1. Sign in with Google or GitHub.
2. Enter an authorized personal workspace.
3. Capture an intention/action.
4. Organize Goals -> Projects -> Tasks and recurring Habits.
5. Select bounded Today priorities/schedules.
6. Complete work with replay-safe evidence.
7. Receive bounded reminders.
8. Perform daily/weekly review.
9. Synchronize selected commitments with an authorized calendar connection.
10. Optionally request an auditable AI proposal.
11. Explicitly accept/reject the proposal.
12. Export or erase data through recent-authenticated, durable orchestration.
13. Resume on another device without silent stale overwrite.
14. Recover through supported backup/restore and operator runbooks.

## 7. Functional requirements

### Identity and workspace

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-ID-001 | Google/GitHub login through bounded OAuth/OIDC contracts. | Implemented on protected main | Identity OAuth/session tests. |
| PRD-ID-002 | Revocable workspace-scoped browser sessions. | Implemented on protected main | Identity runtime/session persistence. |
| PRD-ID-003 | Opaque UUIDv4 internal identifiers. | Implemented on protected main | Architecture, migrations and validators. |
| PRD-ID-004 | Tenant authority from trusted context, not arbitrary client ownership fields. | Implemented on protected main | Cross-tenant tests; calendar trusted-context PR #139 merged as `eb4ff993a6c8f948377d68d186130c149f370154`. |
| PRD-ID-005 | Preserve authentication age separately from session rotation. | Implemented on protected main | #134-#137. |

### Planning, habits and reviews

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-PLAN-001 | Durable goals/projects/tasks and tenant-safe search. | Implemented on protected main | Planning PostgreSQL/search tests. |
| PRD-PLAN-002 | Explicit local-draft to durable Today synchronization with optimistic concurrency. | Implemented on protected main | PR #127 merged as `f4cae6d83eadb00019d2962a650c55c59a3349ae`; issue #121 closed. |
| PRD-HAB-001 | Recurring habits with replay-safe completion history. | Implemented on protected main | Habit service tests. |
| PRD-REV-001 | Guided review over durable evidence without becoming planning mutation authority. | Implemented on protected main | Review service tests/boundary. |

### Calendar and reminders

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-CAL-001 | Conflict-safe CalDAV/Google synchronization. | Implemented on protected main | Provider adapter tests. |
| PRD-CAL-002 | Reject legacy client-selected workspace authority using trusted signed context. | Implemented on protected main | PR #139 merged as `eb4ff993a6c8f948377d68d186130c149f370154`. |
| PRD-CAL-003 | Hosted per-user encrypted credential storage, OAuth state/PKCE, refresh/revocation and calendar selection. | Partial | Issue #129. |
| PRD-NOT-001 | Timezone-correct bounded reminders with durable retry/fatigue behavior. | Implemented on protected main | Notification tests. |

### AI assistance

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-AI-001 | Model output is inert proposal data, never direct execution authority. | Implemented on protected main | AI proposal/audit tests. |
| PRD-AI-002 | Persist proposal evidence and replay-safe explicit decisions. | Implemented on protected main | AI audit persistence/API. |
| PRD-AI-003 | Deterministic quality/safety gates remain independent of live-provider availability. | Implemented on protected main | Evaluator + bounded NIM conformance. |
| PRD-AI-004 | Deeper orchestration requires measured benefit over a strong single-route baseline. | Accepted architecture | Architecture/conformance evidence. |

### Privacy and data rights

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-PRIV-001 | Purpose-bound sensitive access with bounded grants/evidence. | Implemented on protected main | Privacy service. |
| PRD-PRIV-002 | Real recent-authentication policy for data-rights operations. | Implemented on protected main | #134-#137. |
| PRD-PRIV-003 | Durable data-rights request/receipt ledger plus tenant-scoped status lookup. | Implemented on protected main | #138 and PR #144 merged as `dcc787f77b708cecda054b47d6f7d7b561575a67`. |
| PRD-PRIV-004 | Complete export/erasure participation, reconciliation, protected delivery, retention/legal-hold/backup-expiry and operator recovery. | Partial | Issue #55. |

### Plugins, web and operations

| ID | Requirement | Status | Evidence / gap |
| --- | --- | --- | --- |
| PRD-INT-001 | Versioned plugin contracts without direct DB authority. | Implemented on protected main | Plugin SDK/integration service. |
| PRD-INT-002 | Installation grants, encrypted secrets, SSRF-safe delivery, retry/audit and revocation. | Planned | Issue #130. |
| PRD-WEB-001 | Responsive installable PWA, accessible core flows and Korean/English catalogs. | Implemented on protected main | Browser/accessibility/localization tests. |
| PRD-OPS-001 | Verified logical backup/restore and provider-neutral deployment reference. | Implemented on protected main | `infra/backup/`, `infra/kubernetes/`. |
| PRD-GOV-001 | Separate configured capability maturity from canonical buyer-gap state. | Implemented on protected main | Current readiness reports 22/22 maturity and three unresolved buyer gaps (#55/#129/#130). |
| PRD-GOV-002 | Distinguish exact contributor-head source evidence from synthetic merge-tree compatibility evidence. | Planned | Issue #132. |

## 8. Non-functional requirements

- Fail closed on malformed ownership, identifiers, signatures, digests, timestamps and provider responses.
- Parameterize SQL and isolate service credentials.
- Use idempotency and explicit revisions/preconditions where replay or lost update is plausible.
- Keep logs/errors/public artifacts credential-free and avoid unnecessary personal text.
- Use realistic PostgreSQL/browser/concurrency/migration/security tests where those boundaries matter.
- Packages declaring exact coverage gates maintain meaningful 100% statement/branch/function/line coverage.
- Operator-owned infrastructure and upstream-provided software remain explicit.

## 9. Non-goals

LifeOS does not claim medical/psychological diagnosis, autonomous consequential decisions, silent AI mutation, provider availability guarantees, direct cross-service database writes, certification without independent evidence, or fixed public SLA/RPO/RTO values without measured deployment evidence.

## 10. Stable release outcome

The first stable release requires one protected integrated head where the primary buyer journey, canonical buyer-gap state, tenant/privacy boundaries, migrations, backup/restore, deployment, accessibility/localization, packaging/SBOM/provenance, security and actual review policy pass together. A merged feature or documentation PR alone is not a release.