# LifeOS Product Requirements Document

**Version:** 1.0-draft  
**Baseline date:** 2026-08-09  
**Product:** LifeOS  
**Repository:** `ContextualWisdomLab/life-os`

## 1. Product definition

LifeOS is an open-source, privacy-first personal operating system that connects long-term goals to projects, tasks, habits, calendar commitments, reviews, and auditable AI assistance. It is designed for multi-user server-backed operation while remaining self-hostable and modular.

LifeOS is not a flat checklist and AI is not an autonomous owner of user data. The product promise is:

> **Turn intentions into an explainable, recoverable action loop while keeping the user in authority over personal data and AI-assisted decisions.**

## 2. Status convention

Every requirement uses one of these statuses:

- **Implemented on protected main**
- **Implemented on active PR**
- **Partial**
- **Accepted architecture**
- **Planned**
- **Research only**
- **Superseded**
- **Out of scope**

Protected-main source and tests, not this document, are authoritative for an `Implemented` claim.

## 3. Target users

### Primary

- Individuals who want goals, projects, tasks, habits, and reviews in one system.
- Knowledge workers who need to understand why a task exists and what objective it advances.
- Users who need cross-device durable state rather than a browser-only checklist.
- Self-hosters and organizations that want an inspectable open-source personal productivity platform.

### Secondary

- Small teams that may later share workspaces and planning objects.
- Developers building integrations or plugins against versioned LifeOS contracts.
- Researchers or advanced users using consented personal-history exports for longitudinal analysis outside the transactional product core.

### Operators

- Self-hosters and enterprise platform teams responsible for deployment, PostgreSQL, NATS, secrets, backup storage, identity-provider registration, network policy, monitoring, and incident response.

## 4. Product principles

1. **Goal-connected action.** Tasks and habits can be traced to projects/goals where relevant.
2. **User authority.** User-authored state is never silently changed by AI.
3. **Durable ownership.** Server-side domain services own authoritative persisted state; browser-local state is explicitly labeled draft/cache/offline state.
4. **Tenant safety.** Workspace ownership is derived from authenticated context, not trusted from arbitrary client identifiers.
5. **Modular MSA.** Each bounded service owns its contracts, persistence, migrations, tests, runtime, and failure behavior.
6. **Portable deployment.** Compose supports local/self-hosted composition and Kubernetes provides a provider-neutral production reference without hiding operator responsibilities.
7. **Auditable assistance.** AI output is stored as inert proposal/evidence with explicit accept/reject history where implemented.
8. **Recoverability.** Idempotency, optimistic concurrency, backup/restore, bounded retries, and failure evidence are product features rather than operational afterthoughts.
9. **Accessibility and localization.** Core journeys are keyboard operable and Korean/English capable; status is not conveyed by color alone.
10. **Evidence over claims.** Product maturity comes from code-current tests and protected-main evidence, not roadmap labels.

## 5. Historical decisions

### Superseded: login-free local-first product as primary architecture

Early exploration considered IndexedDB-only storage with no account. The product later moved to Google/GitHub authentication, personal workspaces, PostgreSQL-backed services, and multi-device durability. Local browser state remains useful for explicit drafts/offline UX, but is not the system of record.

### Superseded: single application as the durable architecture

A single Docker application was considered as a fast deployment path. Current LifeOS uses domain-oriented independent services composed by the repository. Docker Compose is a deployment profile, not a collapse of service ownership.

### Superseded: UUIDv7 internal identifiers

The initial combined design proposed UUIDv7. Current protected-main repository contracts require opaque UUIDv4 internal identifiers. See ADR-0002.

## 6. Core customer journey

The target end-to-end customer journey is:

1. Sign in with Google or GitHub.
2. Receive or access an authorized personal workspace.
3. Capture an intention/action quickly.
4. Organize durable Goals → Projects → Tasks and recurring Habits.
5. Select realistic Today priorities and scheduled actions.
6. Complete work and retain immutable/idempotent completion evidence where applicable.
7. Receive bounded reminders without duplicate delivery or notification fatigue.
8. Review progress and stalled work in daily/weekly review flows.
9. Synchronize selected commitments with an authorized calendar provider.
10. Optionally request an AI proposal based on bounded context.
11. Inspect proposal evidence and explicitly accept/reject; AI does not silently mutate planning data.
12. Exercise privacy/data-rights controls and recover data through supported export/backup paths.
13. Continue across phone/tablet/desktop through the responsive PWA and durable server state.

A release should be judged by how many of these steps work end-to-end, not by the number of services or abstractions present.

## 7. Functional requirements

### Identity and workspace

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-ID-001 | Support Google and GitHub login through bounded OAuth/OIDC provider contracts. | Implemented on protected main | `identity.oauth-session`; identity integration tests |
| PRD-ID-002 | Issue revocable workspace-scoped browser sessions without exposing provider secrets to downstream services. | Implemented on protected main | identity runtime/session tests |
| PRD-ID-003 | Internal IDs are opaque UUIDv4 values; numeric provider IDs remain provider metadata only. | Implemented on protected main | `AGENTS.md`, `ARCHITECTURE.md`, migration/tests |
| PRD-ID-004 | Derive workspace/user authority from authenticated context and fail closed on cross-tenant access. | Implemented on protected main | identity/planning/AI/privacy tests |
| PRD-ID-005 | Support future non-personal workspace memberships without weakening personal-workspace isolation. | Accepted architecture | initial domain model; no team-workspace GA claim |

### Goals, projects, tasks and Today

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-PLAN-001 | Persist goals, projects, milestones and tasks across process restarts. | Implemented on protected main | `planning.durable-data` |
| PRD-PLAN-002 | Provide tenant-safe search over durable planning objects with bounded Unicode-normalized behavior. | Implemented on protected main | `capture.search` |
| PRD-PLAN-003 | Provide a fast capture experience without presenting local drafts as durable records. | Implemented on protected main | quick-capture component/e2e |
| PRD-PLAN-004 | Provide a Today action loop with bounded priorities and completion workflow. | Implemented on protected main | `today.action-loop` |
| PRD-PLAN-005 | Prevent stale concurrent updates from silently overwriting newer durable Today state across devices. | Partial | issue #121; durable planning exists but full optimistic multi-device Today synchronization remains incomplete |
| PRD-PLAN-006 | Keep planning source-of-truth inside planning-service; review/search projections never become mutation authority. | Implemented on protected main | service ownership and repository tests |

### Habits and reviews

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-HAB-001 | Define recurring habits and retain completion history independently from recurrence-definition changes. | Implemented on protected main | `habit.recurring-core` |
| PRD-HAB-002 | Make completion recording replay-safe and tenant scoped. | Implemented on protected main | habit PostgreSQL integration tests |
| PRD-REV-001 | Support guided daily/weekly review using durable planning/habit evidence. | Implemented on protected main | `review.guided-loop` |
| PRD-REV-002 | Preserve review output as projection/evidence rather than silently rewriting source planning objects. | Implemented on protected main | review service boundary |

### Calendar and notifications

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-CAL-001 | Synchronize selected commitments through explicit provider adapters with idempotency/concurrency protection. | Implemented on protected main | `calendar.time-blocking`; CalDAV/Google tests; completed #51 |
| PRD-CAL-002 | Avoid duplicate/destructive provider updates through deterministic identifiers and strong preconditions. | Implemented on protected main | provider integration tests |
| PRD-CAL-003 | Store/refresh/revoke per-user Google Calendar credentials for hosted multi-user use. | Partial | issue #129; current adapter still uses an operator-supplied runtime token rather than a complete per-user credential lifecycle |
| PRD-NOT-001 | Deliver timezone-correct bounded reminders with fatigue controls. | Implemented on protected main | `notifications.reminders` |
| PRD-NOT-002 | Recover expired claims/retries without duplicate inbox delivery. | Implemented on protected main | notification integration tests |

### AI assistance

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-AI-001 | Treat model output as an inert proposal, never an execution command. | Implemented on protected main | AI service architecture/tests |
| PRD-AI-002 | Persist proposal evidence before return and retain replay-safe accept/reject decision history. | Implemented on protected main | AI audit persistence/tests |
| PRD-AI-003 | Derive actor/workspace context from the authenticated web boundary and never forward browser credentials. | Implemented on protected main | same-origin AI BFF tests |
| PRD-AI-004 | Keep deterministic proposal-quality/safety evaluation independent of live-provider availability. | Implemented on protected main | proposal evaluator + NIM conformance split |
| PRD-AI-005 | Permit deeper orchestration only when measured quality/control evidence justifies it against a strong single-route baseline. | Accepted architecture / implemented evaluation support | `ARCHITECTURE.md`, NIM conformance harness |
| PRD-AI-006 | Autonomous developer automation may create bounded reviewed work but may not become product data authority. | Implemented on protected main | PR #122 merged as `876850018a17323900844e79845ba395b7bf6a9a`; `.github/workflows/opencode-commercial-development.yml`; `packages/commercial-development-agent/` |

### Privacy, security and data rights

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-PRIV-001 | Protect sensitive data through purpose-bound authorization, tenant scope, encryption/secret boundaries and auditable access rather than blanket masking. | Implemented on protected main | privacy-service work merged in #124 |
| PRD-PRIV-002 | Make privacy access decisions/evidence append-only and grants bounded/single-use where designed. | Implemented on protected main | privacy PostgreSQL/security tests |
| PRD-PRIV-003 | Keep credentials, raw prompts/responses, hidden reasoning and unbounded tenant content out of retained public artifacts. | Implemented on protected main | repository-wide contracts/security tests |
| PRD-PRIV-004 | Provide user-facing export/deletion lifecycle with durable job/audit evidence before claiming complete data-rights UX. | Partial | issue #55; identity-owned core exists but concrete domain participation, durable orchestration/reconciliation, recent-auth and delivery/audit lifecycle remain incomplete |

### Integration and extensibility

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-INT-001 | Expose a versioned plugin contract without granting plugins direct cross-service database authority. | Implemented on protected main | plugin SDK + integration service |
| PRD-INT-002 | Validate untrusted plugin manifests/events and preserve tenant-scoped provenance. | Implemented on protected main | plugin contract tests |
| PRD-INT-003 | Add installation, secret persistence and outbound plugin delivery only behind separately reviewed authorization/SSRF/audit boundaries. | Planned | explicitly deferred in README |
| PRD-INT-004 | Compose with optional CWL services through stable interfaces while preserving standalone LifeOS operation. | Accepted architecture | architecture/agent contracts |

### Web, PWA, accessibility and localization

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-WEB-001 | Provide responsive installable PWA behavior on phone/tablet/desktop. | Implemented on protected main | `mobile.pwa` |
| PRD-WEB-002 | Make core journeys keyboard operable with visible focus and non-color-only status. | Implemented on protected main | accessibility tests/e2e |
| PRD-WEB-003 | Provide structurally complete Korean and English message catalogs. | Implemented on protected main | `accessibility.localization` / changelog |
| PRD-WEB-004 | Preserve/recover explicitly local offline drafts without silently uploading them. | Partial | local Today draft distinction exists; complete reconnect/conflict recovery overlaps issue #121 |

### Backup, deployment and operations

| ID | Requirement | Status | Representative evidence |
| --- | --- | --- | --- |
| PRD-OPS-001 | Provide verified PostgreSQL logical backup/restore with corruption and unsafe-target refusal. | Implemented on protected main | backup scripts/tests/runbook |
| PRD-OPS-002 | Provide provider-neutral production reference deployment with restricted runtime defaults and explicit operator-owned dependencies. | Implemented on protected main | Kustomize/deployment tests/runbook |
| PRD-OPS-003 | Expose bounded health/readiness/metrics and preserve monitoring data as an operator-only surface. | Implemented on protected main | service endpoints/runbooks |
| PRD-OPS-004 | Do not claim point-in-time recovery, managed cluster provisioning, or a fixed public SLA without measured/operator-specific evidence. | Implemented documentation boundary | README/runbooks |

## 8. Non-functional requirements

### Security and privacy

- Fail closed on malformed ownership, identifiers, signatures, digests, timestamps, untrusted provider responses, and configuration.
- Keep SQL structure static and parameterize dynamic values.
- Protect service credentials and third-party access tokens from browser/model/artifact exposure.
- Preserve tenant isolation in every repository and integration test that crosses a service persistence boundary.
- Treat external responses, connector data, model output, calendar payloads and plugin manifests as untrusted.

### Reliability and consistency

- Mutations that may be replayed use idempotency controls.
- Concurrent/stale mutations use explicit version/digest/ETag/precondition mechanisms where loss is plausible.
- Durable workers support bounded retries/claims and expose sanitized failure states.
- Cross-service event consumers are idempotent where at-least-once delivery is possible.

### Quality

- Public production declarations have beginner-readable documentation.
- Packages that define exact coverage gates maintain 100% statement/branch/function/line coverage with meaningful tests.
- Core customer journeys include realistic PostgreSQL and browser integration evidence rather than mock-only success.
- Accessibility/localization/security/backup/release behavior is tested as product behavior.

### Operability

- A self-hoster can understand what LifeOS provides versus what the operator must provision.
- Failures expose credential-free diagnostics and correlation/evidence identifiers.
- Release claims require exact integrated CI/security/package/provenance/recovery evidence.

## 9. Explicit non-goals

LifeOS does not claim or provide as a product contract:

- medical or psychological diagnosis or treatment;
- autonomous consequential employment, admission, insurance, credit, legal or similar decisions;
- silent AI mutation of user-owned state;
- guaranteed availability of external model/calendar/identity providers;
- a proprietary Google-operated backend hidden behind the open-source project;
- cross-service direct database writes;
- certification claims (for example SOC 2 or CSAP) without independent certification evidence;
- a public SLA/RPO/RTO value that has not been measured for a specific operated deployment.

## 10. Release outcome

The first stable release requires more than individual capability maturity. It requires one protected integrated head where the primary customer journey, tenant/privacy boundaries, migrations, backup/restore, deployment, accessibility/localization, packaging/SBOM/provenance, security checks, and required review gates all pass together. Versioning and `CHANGELOG.md` release sections are updated only after that evidence exists.
