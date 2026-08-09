# Canonical Product Architecture Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LifeOS product, technical, architectural, data, security, operational, and decision boundaries reconstructable from the repository without relying on chat history or scattered feature plans.

**Architecture:** Keep root `ARCHITECTURE.md` as the durable system boundary, add canonical product/technical/data/UML/security/operations/traceability documents under `docs/`, and add an ADR index with explicit supersession history. Every document distinguishes as-built protected-main behavior from active-PR, accepted architecture, planned, superseded, research-only, and out-of-scope material.

**Tech Stack:** Markdown, Mermaid diagram-as-code, existing TypeScript/NestJS/Next.js/PostgreSQL/NATS contracts, GitHub documentation links.

## Global Constraints

- Protected-main behavior is authoritative for claims marked implemented.
- Internal identifiers are opaque UUIDv4 strings on current protected main.
- Services never read or mutate another service's database tables directly.
- AI proposals are inert until an explicitly authorized user decision path acts on them.
- Database object names are descriptive multiword `snake_case` unless an external protocol requires otherwise.
- Do not invent persistence, SLO values, provider capabilities, certifications, or release status.
- Historical conversation/design choices must be recorded as superseded rather than silently deleted.

---

### Task 1: Audit and canonical documentation spine

**Files:**
- Create: `docs/DOCUMENTATION_ASSESSMENT.md`
- Create: `docs/PRD.md`
- Create: `docs/TRD.md`

**Interfaces:**
- Consumes: protected-main `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `product/capabilities.json`, existing feature specs/runbooks.
- Produces: canonical product requirements and technical requirements referenced by all later documentation.

- [ ] Verify every claimed implemented capability against protected-main source/evidence.
- [ ] Record missing canonical document families and contradictory historical choices.
- [ ] Write PRD requirements with status and evidence references.
- [ ] Write TRD service, protocol, security, concurrency, degraded-mode, deployment, and release requirements.
- [ ] Re-read all three files and remove any unimplemented claim presented as shipped.

### Task 2: Data model and UML views

**Files:**
- Create: `docs/DATA_MODEL.md`
- Create: `docs/UML.md`

**Interfaces:**
- Consumes: PRD/TRD and protected-main service ownership.
- Produces: conceptual/logical entity model and code-current component/sequence/state/deployment diagrams.

- [ ] Model service-owned entities and explicitly label conceptual versus persisted records.
- [ ] Prohibit cross-service database foreign-key coupling in the logical model.
- [ ] Add identity/workspace, Today/planning, habit, review, notification/calendar, AI decision, privacy access, backup/deployment flows.
- [ ] Add degraded/failure-state diagrams where behavior is materially different.

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

- [ ] Record local-first/private and single-Docker ideas as superseded by current multi-user/self-hostable modular MSA.
- [ ] Explicitly supersede the old UUIDv7 design statement with the current UUIDv4 invariant.
- [ ] Capture service-owned persistence, AI authority, privacy access, autonomous-loop, and documentation decisions.
- [ ] Index all ADRs with status and scope.

### Task 4: Security, testing, operations, and traceability

**Files:**
- Create: `docs/THREAT_MODEL.md`
- Create: `docs/TEST_STRATEGY.md`
- Create: `docs/OPERABILITY.md`
- Create: `docs/TRACEABILITY.md`

**Interfaces:**
- Consumes: current security policy, runbooks, CI, capability manifest, service implementations.
- Produces: threat/quality/operator contracts and requirement-to-evidence mapping.

- [ ] Enumerate assets, trust boundaries, threats, mitigations, residual risks, and incident evidence.
- [ ] Separate deterministic merge gates from bounded live-provider conformance.
- [ ] Document Compose and Kubernetes reference deployment boundaries without inventing infrastructure ownership.
- [ ] Map representative PRD requirements to capability IDs, modules, tests, runbooks, and open gaps.

### Task 5: Root documentation alignment

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: one discoverable documentation entry point and consistent repository-wide instructions.

- [ ] Add notification and privacy bounded contexts to the architecture topology where protected main supports them.
- [ ] Link the canonical documentation graph from README and documentation hierarchy sections.
- [ ] Mark the 2026-08-02 design as historical rather than the current product source of truth.
- [ ] Require documentation status/evidence discipline in agent handoffs.
- [ ] Record the documentation baseline under `Unreleased` without changing product version.

### Task 6: Verification and continuation

**Files:**
- Review all changed Markdown files.

**Interfaces:**
- Consumes: complete documentation baseline.
- Produces: reviewable documentation PR and an executable next-gap queue.

- [ ] Verify links and Mermaid/code fences manually from exact branch content.
- [ ] Compare protected-main names and capability evidence against the new docs.
- [ ] Open one reviewable PR against `main`.
- [ ] Inspect exact-head checks and reviews.
- [ ] Do not stop at documentation: identify the highest-priority implementation gap exposed by `docs/TRACEABILITY.md` and continue it in the maintenance loop when branch/writer budget permits.
