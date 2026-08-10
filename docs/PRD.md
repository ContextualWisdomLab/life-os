# LifeOS Product Requirements Document

**Status:** Implemented on active PR

This document is the canonical product-level requirements index for LifeOS. Protected-main code, migrations, tests, and current GitHub policy are authoritative for shipped behavior.

## Product definition

LifeOS is a privacy-first, multi-user, server-backed and self-hostable personal operating system that connects Goals, Projects, Tasks, Habits, Today planning, review, calendar/reminders, auditable AI assistance, privacy/data-rights controls, and operator recovery into one user-authoritative workflow.

## Historical decisions

- **Superseded:** login-free browser-only/local-first storage as the primary architecture. Browser-local state remains valid only for explicit drafts/cache/offline UX.
- **Superseded:** a single Docker application as the durable product architecture. Docker Compose remains a deployment profile; domain services keep independent authority.
- **Superseded:** UUIDv7 internal identifiers. Protected main uses opaque UUIDv4 internal identifiers.

## Status vocabulary

Canonical requirements use exactly one of: `Implemented on protected main`, `Implemented on active PR`, `Partial`, `Accepted architecture`, `Planned`, `Research only`, `Superseded`, `Out of scope`.

## Primary customer journey

1. Google/GitHub login and personal workspace provisioning.
2. Goal -> Project -> Task and recurring Habit organization.
3. Explicit Today planning and completion.
4. Durable cross-device synchronization without silent stale overwrites.
5. Daily/weekly review based on durable evidence.
6. Calendar synchronization and bounded reminders.
7. Optional AI proposal generation with evidence and explicit accept/reject.
8. Privacy/data-rights request, status, export and deletion lifecycle.
9. Backup/recovery and accessible Korean/English PWA operation.
10. Operator deployment, readiness, observability, migration and release evidence.

## Functional requirements

| ID | Requirement | Status | Evidence / tracking |
| --- | --- | --- | --- |
| PRD-ID-001 | Google and GitHub login with revocable server-side sessions and tenant-derived authority. | Implemented on protected main | identity service and OAuth/session tests |
| PRD-ID-002 | Internal identifiers are opaque UUIDv4; provider IDs remain mapped metadata. | Implemented on protected main | `AGENTS.md`, service validators/migrations |
| PRD-PLAN-001 | Persist Goals, Projects and Tasks in planning-service-owned PostgreSQL. | Implemented on protected main | planning migrations/repository tests |
| PRD-PLAN-002 | Explicit durable Today synchronization with strong preconditions, idempotency and stale conflict handling. | Implemented on protected main | PR #127 merged as protected main; browser and PostgreSQL concurrency tests |
| PRD-HAB-001 | Recurring habits and durable completion history. | Implemented on protected main | habit service PostgreSQL tests |
| PRD-REV-001 | Guided review without becoming planning mutation authority. | Implemented on protected main | review service boundary/tests |
| PRD-CAL-001 | Conflict-safe CalDAV/Google calendar synchronization. | Implemented on protected main | calendar adapter tests |
| PRD-CAL-002 | Derive calendar workspace authority from signed trusted context, not legacy client headers. | Implemented on protected main | PR #139 merged; trusted-context tests |
| PRD-CAL-003 | Complete per-user encrypted Google/CalDAV credential lifecycle, OAuth/PKCE, refresh/revocation, discovery and calendar selection. | Partial | issue #129 |
| PRD-CAL-004 | Persist a LifeOS-owned calendar-connection foundation scoped to workspace and user, with bounded provider metadata, normalized scopes and opaque secret handles rather than plaintext provider tokens. | Implemented on protected main | PR #150 merged as `1623df364925f84920c07c112f1ae96777277d20`; does not complete #129 |
| PRD-NOT-001 | Timezone-correct bounded reminders with replay-safe delivery. | Implemented on protected main | notification persistence/scheduler tests |
| PRD-AI-001 | AI output is inert proposal evidence until explicit authorized decision. | Implemented on protected main | AI proposal/audit tests |
| PRD-AI-002 | Deterministic proposal-quality/safety gates remain independent of live provider availability. | Implemented on protected main | evaluator/live-conformance split |
| PRD-PRIV-001 | Sensitive data access is tenant/purpose/lifetime/audit bound rather than blanket-masked. | Implemented on protected main | privacy-service tests |
| PRD-PRIV-002 | Data-rights requests preserve recent-auth provenance and durable immutable request/terminal receipts. | Implemented on protected main | PRs #134, #136, #137, #138 and #144 integrated on main |
| PRD-PRIV-003 | Complete export/deletion orchestration across every owned domain, protected delivery lifecycle, retention/legal-hold handling and reconciliation. | Partial | issue #55 |
| PRD-PRIV-004 | An authenticated user can query one owned data-rights request through a tenant-and-actor scoped, bounded, non-cacheable public status resource without exposing workspace/user IDs, idempotency material or receipt digests. | Implemented on protected main | PR #146 merged; session-derived scope and bounded 400/401/404/503 behavior |
| PRD-PRIV-005 | Tenant-export sections carry contributor-defined safe record counts and deterministic per-section SHA-256 integrity evidence, with locale-independent property ordering and a whole-export digest. | Implemented on protected main | PR #149 merged; integrity regression and RFC 8785/FIPS 180-4 doctoring |
| PRD-INT-001 | Versioned plugin SDK/validation without direct database authority. | Implemented on protected main | plugin SDK/integration-service tests |
| PRD-INT-002 | Complete plugin runtime installation, encrypted secret storage, SSRF-safe outbound delivery, retries/dead-letter behavior and revocation. | Partial | protected installation authority now exists; durable secret/delivery runtime remains issue #130 |
| PRD-INT-003 | Treat a validated manifest as untrusted intent and grant only explicit tenant-scoped installation capabilities with exact replay/conflict/revocation semantics. | Implemented on protected main | PR #151 merged as `6971c4e11b3204ec41526c7c959a248e54440e1c`; no durable secret/delivery authority implied |
| PRD-WEB-001 | Responsive installable PWA with keyboard-operable core flows and Korean/English catalogs. | Implemented on protected main | browser/accessibility/localization tests |
| PRD-OPS-001 | Logical PostgreSQL backup/restore with integrity and unsafe-target refusal. | Implemented on protected main | backup scripts/tests/runbook |
| PRD-OPS-002 | Provider-neutral production reference deployment and bounded health/readiness/metrics. | Implemented on protected main | infra and observability tests |
| PRD-GOV-001 | Capability maturity and buyer-gap exhaustion are reported independently. | Implemented on protected main | buyer-gap registry and issue #21 report |
| PRD-GOV-002 | Required PR verification identifies the commit tree actually checked and does not conflate exact source-head verification, stale PR-base snapshots, independently resolved live-base state or synthetic-merge compatibility evidence. | Implemented on active PR | clean successor PR #154 advances issue #132; ADR 0010 defines the evidence identities; #147 is superseded |

## Non-functional requirements

- Fail closed on malformed ownership, UUIDs, signatures, digests, timestamps and untrusted provider data.
- Parameterize dynamic SQL and keep service-owned database authority explicit.
- Use idempotency and version/precondition controls wherever replay or stale overwrite can cause loss.
- Public errors/logs/metrics/artifacts exclude credentials, hidden reasoning and unbounded tenant content.
- Integrity digests are evidence, not authorization, confidentiality, provenance or digital signatures.
- Core customer journeys require realistic PostgreSQL and browser evidence, not mock-only success.
- Product-owned production packages maintain exact coverage gates where configured and beginner-readable public documentation.
- Verification evidence remains bound to the exact commit tree it inspected rather than being promoted across source, merge, base or release identities.

## Non-goals

LifeOS does not claim medical diagnosis/treatment, autonomous consequential employment/credit/legal decisions, silent AI mutation of user data, provider availability guarantees, cross-service direct database access, certification without independent evidence, or unmeasured public SLA/RPO/RTO values.

## Release outcome

A stable release requires one exact protected integrated head where product journey, tenant/privacy boundaries, required CI/security/review, coverage, packaging, SBOM/provenance, migration/rollback, backup/restore, accessibility/localization, deployment and operational acceptance pass together.
