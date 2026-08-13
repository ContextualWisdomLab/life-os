# LifeOS Product Requirements Document

**Status:** Implemented on active PR

Protected-main code, migrations, tests, and live GitHub policy are authoritative for shipped behavior. This PRD is the canonical product-level index; active pull requests are labeled and never promoted to protected truth.

## Product definition

LifeOS is a privacy-first, multi-user, server-backed, self-hostable personal operating system connecting Goals, Projects, Tasks, Habits, Today planning, Review, Calendar, reminders, auditable AI proposals, privacy/data-rights controls, plugins, and operator recovery in one user-authoritative workflow.

## Superseded product assumptions

- Login-free browser-only/local-first storage as the primary architecture is **Superseded**.
- UUIDv7 internal identifiers are **Superseded** by opaque UUIDv4 product IDs.
- A single durable application and private-personal-only positioning are **Superseded** by modular service ownership and public multi-user operation.
- Browser-local state remains supported only as explicit draft/cache/offline state until an owning service accepts it.

## Primary customer journey

1. Authenticate with Google or GitHub and enter an authorized workspace.
2. Organize Goals, Projects, Tasks, and recurring Habits.
3. Create and synchronize an explicit Today plan without silent overwrite.
4. Complete work and inspect durable guided Review evidence.
5. Connect one authorized calendar account and run conflict-safe synchronization.
6. Receive bounded timezone-correct reminders.
7. Request an inert AI proposal and explicitly accept or reject its evidence.
8. Request, inspect, export, and delete personal/workspace data through service-owned contributors.
9. Install explicitly granted plugins without database or arbitrary network authority.
10. Recover, migrate, deploy, observe, and release from auditable protected evidence.

## Functional requirements

| ID | Requirement | Status | Evidence / tracking |
| --- | --- | --- | --- |
| PRD-ID-001 | Google/GitHub login, revocable server sessions, workspace membership, and preserved authentication-age provenance. | Implemented on protected main | Identity source/migrations/tests |
| PRD-ID-002 | Internal/public product IDs are opaque UUIDv4; external IDs remain bounded metadata. | Implemented on protected main | `AGENTS.md`, validators, migrations, ADR 0001 |
| PRD-PLAN-001 | Planning owns durable Goals, Projects, Tasks, search, and Today persistence. | Implemented on protected main | Planning migrations/repositories |
| PRD-PLAN-002 | Today synchronization uses explicit acceptance, strong preconditions, idempotency, and stale-conflict reconciliation. | Implemented on protected main | PR #127 |
| PRD-PLAN-003 | Every public Planning route derives signed workspace authority and binds it to the exact method/path/request. | Implemented on protected main | PR #168 and PR #188 |
| PRD-HAB-001 | Habit owns recurring definitions and replay-safe completion history. | Implemented on protected main | Habit migrations/tests |
| PRD-HAB-002 | Every public Habit route derives signed workspace authority; trusted contributor transport consumes destructive authority once. | Implemented on protected main | PR #173 and PR #192 |
| PRD-REV-001 | Review owns guided-review persistence/projections without Planning or Habit mutation authority. | Implemented on protected main | Review service boundaries |
| PRD-REV-002 | Guided-review routes require request-bound signed workspace authority. | Implemented on protected main | PR #185 |
| PRD-CAL-001 | Google/CalDAV synchronization is conflict-safe and tenant-scoped. | Implemented on protected main | Calendar provider tests |
| PRD-CAL-002 | Calendar synchronization uses signed trusted workspace context, not browser-selected ownership. | Implemented on protected main | PR #139 |
| PRD-CAL-003 | Complete encrypted per-user credential lifecycle, OAuth/PKCE, refresh/revoke, discovery/selection, and scoped sync. | Partial | issue #129 |
| PRD-CAL-004 | Calendar-owned connection metadata is scoped to exact workspace and user and stores opaque secret references only. | Implemented on protected main | PR #150 |
| PRD-CAL-005 | Local connection revocation is atomic, replay-safe, and tenant/user scoped. | Implemented on protected main | PR #153 |
| PRD-CAL-006 | User-sensitive hosted operations use signed `life-os.calendar-user.v1` workspace+user authority. | Implemented on protected main | PR #155 |
| PRD-CAL-007 | Authenticated disconnect, exact lookup validation, bounded connection read, scoped credential materialization, and authenticated secret-first creation are protected behavior. | Implemented on protected main | PR #157, PR #176, PR #189, PR #193, PR #197 |
| PRD-CAL-008 | Create-evidence mismatch compensates every newly materialized credential before sanitized failure. | Implemented on protected main | PR #201 |
| PRD-NOT-001 | Notification owns bounded timezone-correct reminders, claims, outcomes, retries, and recovery evidence. | Implemented on protected main | Notification migrations/scheduler tests |
| PRD-AI-001 | AI output is inert auditable proposal evidence until explicit authorized accept/reject. | Implemented on protected main | AI proposal/audit service |
| PRD-AI-002 | Deterministic schema/quality/safety gates remain independent of live model availability. | Implemented on protected main | Proposal evaluator and live-conformance split |
| PRD-PRIV-001 | Sensitive access is tenant, actor, purpose, resource, lifetime, and audit bound. | Implemented on protected main | Privacy service |
| PRD-PRIV-002 | Data-rights requests preserve recent-auth provenance, durable request identity, immutable terminal receipts, and bounded status. | Implemented on protected main | PR #146 and predecessor foundations |
| PRD-PRIV-003 | Complete export/deletion orchestration covers every owning domain, reconciliation, retention/legal hold, backup expiry, protected artifact delivery, and final participant-set completion. | Partial | issue #55 |
| PRD-PRIV-004 | Export sections carry deterministic bounded data, safe record counts, and integrity evidence. | Implemented on protected main | PR #149 |
| PRD-PRIV-005 | Independent services use versioned `life-os.data-rights-contributor.v1`, never cross-service SQL. | Implemented on protected main | PR #159 |
| PRD-PRIV-007 | Planning owns a deterministic PostgreSQL-backed contributor and authenticated request-bound transport. | Implemented on protected main | PR #179 and PR #194 |
| PRD-PRIV-008 | Habit owns a deterministic PostgreSQL-backed contributor and replay-safe authenticated transport. | Implemented on protected main | PR #184 and PR #192 |
| PRD-PRIV-009 | Review, Notification, and AI own bounded contributors without widening Identity database authority. | Implemented on active PR | PR #195, PR #198, PR #199 |
| PRD-INT-001 | Plugin SDK/manifest/event contracts are versioned, bounded, and deny direct database authority. | Implemented on protected main | Plugin SDK/integration tests |
| PRD-INT-002 | Complete concrete secret/KMS, authorized-origin outbound delivery, retry/dead-letter, revocation fencing, and operator lifecycle. | Partial | issue #130 |
| PRD-INT-003 | A manifest is intent only; the host grants an explicit tenant/user-scoped capability subset. | Implemented on protected main | PR #151 |
| PRD-INT-004 | Plugin installation persistence is restart-safe and validates exact opaque installation/workspace/installer evidence. | Implemented on protected main | PR #169 and PR #175 |
| PRD-INT-005 | Credential binding stores only opaque secret references and compensates conflicting durable winners. | Implemented on protected main | PR #172 |
| PRD-INT-006 | Operator requests use exact request-bound one-time authority, durable replay protection, and fail-closed HTTP composition. | Implemented on protected main | PR #191 and PR #196 |
| PRD-WEB-001 | The PWA is responsive, keyboard-operable, installable, and structurally localized in Korean and English. | Implemented on protected main | Browser/accessibility/localization tests |
| PRD-WEB-002 | Gateway Today composes authenticated Planning and Habit state without fabricated success. | Implemented on protected main | PR #186 and PR #187; Issue #163 completed |
| PRD-OPS-001 | Logical PostgreSQL backup/restore proves integrity and refuses unsafe targets. | Implemented on protected main | Backup scripts/tests/runbook |
| PRD-OPS-002 | Deployment/readiness/metrics are provider-neutral and bounded. | Implemented on protected main | Compose/Kubernetes/observability evidence |
| PRD-GOV-001 | Capability maturity and canonical buyer-gap exhaustion are reported independently. | Implemented on protected main | Commercial Readiness registry |
| PRD-GOV-002 | Exact source, PR-base snapshot, live base, integration tree, workflow checkout, protected main, and release identities remain distinct. | Implemented on protected main | PR #154 and ADR 0010; issue #132 remains Partial |
| PRD-GOV-003 | Scheduled model-assisted development uses exact pinned OpenCode and independent deterministic gates. | Implemented on protected main | PR #200 repairs the reviewed bootstrap boundary |

## Non-functional requirements

- Fail closed on malformed ownership, UUIDs, signatures, digests, timestamps, cursors, provider evidence, and persisted rows.
- Parameterize dynamic data and keep SQL structures fixed within service-owned schemas.
- Use idempotency, fencing, and version/precondition controls where replay or stale overwrite can cause loss.
- Bound request/response bodies, provider/model outputs, logs, errors, metrics, and retained evidence.
- Credentials, cookies, secret references, raw model prompts/responses, and hidden reasoning never enter public artifacts.
- Integrity digests are evidence, not authorization, confidentiality, provenance, or digital signatures.
- Core customer journeys require realistic PostgreSQL and browser evidence, not mock-only success.
- Product-owned production packages maintain exact configured coverage and beginner-readable public docstrings.
- Pending, skipped, cancelled, absent, stale, predecessor, synthetic-only, or rate-limited evidence is never passing.

## Non-goals

LifeOS does not claim medical diagnosis/treatment, autonomous consequential employment/credit/legal decisions, silent AI mutation, provider availability guarantees, cross-service SQL access, certification without independent evidence, arbitrary plugin code execution, or unmeasured public SLA/RPO/RTO values.

## Release outcome

A stable release requires one unchanged integrated protected head where product journeys, tenant/privacy boundaries, required CI/security/review, coverage/docstrings, packaging, SBOM/provenance/reproducibility, migration/rollback/recovery, accessibility/localization, deployment, and operational acceptance pass together.
