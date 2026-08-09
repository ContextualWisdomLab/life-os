# Canonical Product Architecture Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make LifeOS product, technical, architectural, data, security, privacy, operational, API, release, research, and decision boundaries reconstructable from the repository without relying on chat history or scattered feature plans.

**Architecture:** Keep root `ARCHITECTURE.md` as the durable system boundary, add a canonical documentation graph under `docs/`, and add an ADR index with explicit supersession history. Every document distinguishes protected-main behavior from active-PR, accepted architecture, planned, superseded, research-only, and out-of-scope material.

**Tech Stack:** Markdown, Mermaid diagram-as-code, existing TypeScript/NestJS/Next.js/PostgreSQL/NATS contracts, GitHub documentation links, Node built-in tests for documentation consistency.

## Global Constraints

- Protected-main behavior is authoritative for claims marked implemented.
- Internal identifiers are opaque UUIDv4 strings on current protected main.
- Services never read or mutate another service's database tables directly.
- AI proposals are inert until an explicitly authorized domain path acts on them.
- Database object names are descriptive multiword `snake_case` unless an external protocol requires otherwise.
- Do not invent persistence, SLO values, provider capabilities, certifications, or release status.
- Historical conversation/design choices are recorded as superseded rather than silently deleted.

---

### Task 1: Audit and canonical documentation spine

**Files:**
- Create: `docs/DOCUMENTATION_ASSESSMENT.md`
- Create: `docs/PRD.md`
- Create: `docs/TRD.md`

**Interfaces:**
- Consumes: protected-main `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `product/capabilities.json`, existing feature specs/runbooks.
- Produces: canonical product requirements and technical requirements referenced by all later documentation.

- [x] Verify claimed implemented capabilities against protected-main source/evidence and downgrade unsupported whole-journey claims.
- [x] Record missing canonical document families and contradictory historical choices.
- [x] Write PRD requirements with explicit status and representative evidence.
- [x] Write TRD service, protocol, security, concurrency, degraded-mode, deployment, and release requirements.
- [x] Reconcile the documents after PR #122 merged so the OpenCode loop is protected-main rather than active-PR evidence.

### Task 2: Data model and UML views

**Files:**
- Create: `docs/DATA_MODEL.md`
- Create: `docs/UML.md`

**Interfaces:**
- Consumes: PRD/TRD, protected-main migrations and service ownership.
- Produces: conceptual/logical entity model and code-current component/sequence/state/deployment diagrams.

- [x] Model service-owned entities and explicitly label persisted, projection, logical, partial, and planned records.
- [x] Prohibit cross-service database foreign-key/table-access coupling in the logical model.
- [x] Verify the protected-main Planning migration and present only Goal → Project → Task as current persisted hierarchy; keep milestone/task-dependency concepts planned until implemented.
- [x] Model a future task dependency as exactly one predecessor plus one successor task per dependency record.
- [x] Add identity/workspace, Today/planning, habit, review, notification/calendar, AI decision, privacy access, backup/deployment flows.
- [x] Correct NATS event direction and make per-service PostgreSQL role/schema ownership explicit in UML/deployment diagrams.
- [x] Add degraded/failure-state diagrams where behavior is materially different.

### Task 3: Architecture decisions and historical supersession

**Files:**
- Create: `docs/adr/README.md`
- Create: `docs/adr/0001-product-hosting-and-data-evolution.md`
- Create: `docs/adr/0002-internal-identifiers-uuidv4.md`
- Create: `docs/adr/0003-domain-oriented-service-data-ownership.md`
- Create: `docs/adr/0004-inert-auditable-ai-proposals.md`
- Create: `docs/adr/0005-purpose-bound-sensitive-data-access.md`
- Create: `docs/adr/0006-work-conserving-autonomous-maintenance.md`
- Create: `docs/adr/0007-canonical-documentation-graph.md`

**Interfaces:**
- Consumes: historical design choices plus protected-main implementation.
- Produces: status-bearing decisions with alternatives, consequences, recovery, acceptance, migration, rollback, and supersession rules.

- [x] Record local-first/private and single-Docker ideas as superseded by current multi-user/self-hostable modular MSA.
- [x] Explicitly supersede the old UUIDv7 design statement with the current UUIDv4 invariant.
- [x] Capture service-owned persistence, AI authority, privacy access, autonomous-loop, and canonical-documentation decisions.
- [x] Index every material ADR with status and scope.

### Task 4: Security, privacy, contracts, testing, operations, release, research, and traceability

**Files:**
- Create: `docs/API_CONTRACTS.md`
- Create: `docs/THREAT_MODEL.md`
- Create: `docs/PRIVACY_DATA_LIFECYCLE.md`
- Create: `docs/TEST_STRATEGY.md`
- Create: `docs/OPERABILITY.md`
- Create: `docs/RELEASE_AND_MIGRATION.md`
- Create: `docs/STANDARDS_TRACEABILITY.md`
- Create: `docs/TRACEABILITY.md`

**Interfaces:**
- Consumes: current security policy, service/API/event source, privacy/data-rights code, runbooks, CI, capability manifest, migrations, and research specs.
- Produces: API/event ownership, threat/privacy, quality, operator, release/migration, research and requirement-to-evidence contracts.

- [x] Enumerate assets, trust boundaries, threats, mitigations, residual risks, and incident evidence.
- [x] Separate deterministic merge gates from bounded live-provider conformance.
- [x] Document Compose and Kubernetes reference deployment boundaries without inventing infrastructure ownership or SLA/RPO/RTO values.
- [x] Define API/event/provider contract ownership/evolution without duplicating exact source schemas.
- [x] Define sensitive-data lifecycle, purpose-bound access, retention/export/erasure/backup boundaries and keep incomplete data-rights UX explicitly Partial.
- [x] Define release/migration/rollback rules without implying automatic database/external-side-effect reversibility.
- [x] Classify normative standards, authoritative guidance, peer-reviewed research, preprints/reports and repository experiments.
- [x] Map representative PRD requirements to capabilities, modules, tests, runbooks, active PRs, and live gaps.
- [x] Prove commercial-readiness configured maturity does not imply whole-product gap exhaustion; create issue #128 for the audit defect.
- [x] Split completed CalDAV issue #51 from hosted credential lifecycle issue #129.
- [x] Register plugin runtime installation/secrets/SSRF-safe delivery gap as issue #130.

### Task 5: Root documentation alignment and executable contract

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Create: `packages/commercial-readiness/src/documentation-contract.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: one discoverable documentation entry point, consistent repository-wide instructions and machine-checkable regressions.

- [x] Add notification/privacy/current automation bounded contexts and status to the architecture topology.
- [x] Link every canonical document from README.
- [x] Mark the 2026-08-02 design as historical rather than current product source of truth.
- [x] Require documentation status/evidence/no-early-stop discipline in agent handoffs.
- [x] Record the documentation baseline under `Unreleased` without changing product version.
- [x] Add deterministic tests for canonical file/index links, ADR status/index, fences, UUIDv4/MSA authority, service-owned persistence, inert AI authority, API/privacy/release/research boundaries, and live gap traceability.

### Task 6: Verification and continuation

**Files:**
- Review all changed Markdown/test files.

**Interfaces:**
- Consumes: complete documentation baseline.
- Produces: reviewable documentation PR and an executable next-gap queue.

- [x] Open one reviewable PR #126 against `main`.
- [x] Request CodeRabbit review and inspect all published review threads.
- [x] Address CodeRabbit findings for historical-status clarity, task-dependency cardinality/persistence truth, NATS event direction, per-service database ownership, and this plan's completion state.
- [x] Continue beyond documentation by merging gate-clean PR #122, closing superseded issue #119, closing completed #51, and creating #128/#129/#130.
- [ ] Observe exact-current-head PR #126 CI/AppGuardrail/Semgrep/Security Scan/Commercial Readiness completion after the latest fixes.
- [ ] Reconcile any new exact-head review findings and merge #126 only when configured gates accept the unchanged head.
- [ ] After #126 merges, use the maintenance loop to implement the highest-value executable live gap; documentation completion is not the run/scheduler exit condition.
