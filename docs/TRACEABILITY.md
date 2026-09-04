# LifeOS Requirements and Evidence Traceability

**Status:** Implemented on active PR

Protected-main source/migrations/tests and live repository policy outrank this index. Active-PR evidence remains non-shipped until integration.

## Requirement traceability

| Requirement / decision | Status | Representative evidence | Open follow-up |
| --- | --- | --- | --- |
| PRD-ID-001 login/session/workspace/authentication-age authority | Implemented on protected main | Identity runtime and migrations | — |
| PRD-ID-002 opaque UUIDv4 internal/public product IDs | Implemented on protected main | validators/migrations + ADR 0001 | — |
| PRD-PLAN-001 durable Goals/Projects/Tasks/search | Implemented on protected main | Planning repositories/migrations | — |
| PRD-PLAN-002 durable Today synchronization | Implemented on protected main | PR #127 | — |
| PRD-PLAN-003 signed and exact request-bound Planning authority | Implemented on protected main | PR #168 and PR #188 | — |
| PRD-HAB-001 recurring habits/completion evidence | Implemented on protected main | Habit persistence/tests | — |
| PRD-HAB-002 signed Habit authority and replay-safe contributor transport | Implemented on protected main | PR #173 and PR #192 | — |
| PRD-REV-001 guided Review projection/persistence boundary | Implemented on protected main | Review service tests | — |
| PRD-REV-002 exact request-bound signed Review authority | Implemented on protected main | PR #185 | — |
| PRD-CAL-001 conflict-safe Google/CalDAV synchronization | Implemented on protected main | Calendar provider tests | — |
| PRD-CAL-002 signed workspace synchronization context | Implemented on protected main | PR #139 | — |
| PRD-CAL-003 complete per-user encrypted provider credential lifecycle | Partial | protected foundations below | issue #129 |
| PRD-CAL-004 workspace+user connection metadata and opaque handles | Implemented on protected main | PR #150 | issue #129 |
| PRD-CAL-005 atomic local connection revocation | Implemented on protected main | PR #153 | provider cleanup #129 |
| PRD-CAL-006 signed workspace+user hosted authority | Implemented on protected main | PR #155 | — |
| PRD-CAL-007 authenticated disconnect/read/materialization/create with exact returned evidence | Implemented on protected main | PR #157, PR #176, PR #189, PR #193, PR #197 | issue #129 |
| PRD-CAL-008 returned-create-evidence secret compensation | Implemented on protected main | PR #201 | — |
| PRD-NOT-001 bounded reminders and durable outcomes | Implemented on protected main | Notification migrations/scheduler tests | — |
| PRD-AI-001 inert auditable proposals and explicit decisions | Implemented on protected main | AI proposal/audit tests | — |
| PRD-AI-002 deterministic/live-provider separation | Implemented on protected main | evaluator/live-conformance split | — |
| PRD-PRIV-001 purpose-bound sensitive access | Implemented on protected main | Privacy service | — |
| PRD-PRIV-002 recent-auth + durable request/receipt/status | Implemented on protected main | Identity data-rights foundations | issue #55 parent remains |
| PRD-PRIV-003 complete cross-domain export/deletion/reconciliation/delivery | Partial | protected and active contributors below | issue #55 |
| PRD-PRIV-004 deterministic export integrity evidence | Implemented on protected main | export manifest tests | issue #55 parent remains |
| PRD-PRIV-005 versioned service-owned contributor lifecycle | Implemented on protected main | PR #159 | issue #55 |
| PRD-PRIV-007 Planning contributor and authenticated transport | Implemented on protected main | PR #179 and PR #194 | issue #55 |
| PRD-PRIV-008 Habit contributor and authenticated transport | Implemented on protected main | PR #184 and PR #192 | issue #55 |
| PRD-PRIV-009 Review/Notification/AI contributors | Implemented on active PR | PR #195, PR #198, PR #199 | integrate; remaining owners/reconciliation |
| PRD-INT-001 plugin SDK/manifest/event validation | Implemented on protected main | Plugin SDK/integration tests | — |
| PRD-INT-002 complete concrete secret/outbound delivery runtime | Partial | protected authority foundations below | issue #130 |
| PRD-INT-003 explicit host-owned installation grants | Implemented on protected main | PR #151 | issue #130 parent remains |
| PRD-INT-004 durable exact plugin installation authority | Implemented on protected main | PR #169 and PR #175 | issue #130 |
| PRD-INT-005 opaque credential-binding secret references | Implemented on protected main | PR #172 | concrete KMS #130 |
| PRD-INT-006 one-time request-bound operator authority and HTTP composition | Implemented on protected main | PR #191 and PR #196 | delivery runtime #130 |
| PRD-WEB-001 accessible localized PWA | Implemented on protected main | browser/accessibility/localization tests | — |
| PRD-WEB-002 authenticated real Planning/Habit Today composition | Implemented on protected main | PR #186 and PR #187; Issue #163 completed | — |
| PRD-OPS-001 logical backup/restore integrity | Implemented on protected main | scripts/tests/runbook | — |
| PRD-OPS-002 provider-neutral deployment/readiness/metrics | Implemented on protected main | infrastructure/observability tests | — |
| PRD-GOV-001 buyer-gap vs capability-maturity separation | Implemented on protected main | Commercial Readiness registry | — |
| PRD-GOV-002 exact source/live-base/integration evidence separation | Implemented on protected main | PR #154 + ADR 0010 | Issue #132 remains Partial |
| PRD-GOV-003 exact pinned OpenCode bootstrap policy | Implemented on protected main | PR #200 | fresh protected scheduled-run verification |
| Integration event exact request authority | Implemented on protected main | PR #190 | — |

## Architecture decisions

| Decision | Status | Evidence |
| --- | --- | --- |
| Server-backed self-hostable modular MSA supersedes browser-only primary architecture | Accepted architecture | Architecture + ADR 0009 |
| UUIDv4 supersedes UUIDv7 | Accepted architecture | ADR 0001 |
| Service-owned persistence/no cross-table authority | Accepted architecture | ADR 0003 |
| AI remains inert proposal evidence | Accepted architecture | ADR 0004 |
| Purpose-bound sensitive access | Accepted architecture | ADR 0005 |
| Capability maturity differs from buyer-gap exhaustion | Accepted architecture | ADR 0008 |
| Canonical documentation uses exact maturity vocabulary | Accepted architecture | ADR 0007 |
| Verification identities remain separate | Accepted architecture | ADR 0010 + PR #154 |
| Integration identity, metadata, secret references, and grants remain separate | Accepted architecture | ADR 0011 + protected Calendar/Plugin lines |
| Strong-route model baseline and deterministic review/merge/release authority remain separate | Accepted architecture | ADR 0012 + Fugu/Conductor/TRINITY/counterevidence |

## Protected-main authority chronology since the prior canonical snapshot

- PR #157: authenticated Calendar disconnect.
- PR #159: versioned data-rights contributor lifecycle.
- PR #168 and PR #188: Planning signed/request-bound authority.
- PR #169, PR #172, and PR #175: plugin durable installation, opaque credential binding, and exact evidence validation.
- PR #173: Habit signed authority.
- PR #176 and PR #189: Calendar exact lookup and authenticated read.
- PR #179 and PR #194: Planning contributor and authenticated transport.
- PR #184 and PR #192: Habit contributor and authenticated transport.
- PR #185: Review request-bound authority.
- PR #186 and PR #187: real authenticated Today composition.
- PR #190: request-bound integration event authority.
- PR #191 and PR #196: plugin operator one-time authority and fail-closed HTTP composition.
- PR #193: scoped Calendar credential materialization port.
- PR #197: authenticated Calendar connection creation.
- PR #201: returned-create-evidence validation and reverse-order secret compensation.

## Active-PR evidence

| Pull request | Status | Bounded meaning |
| --- | --- | --- |
| PR #145 | Implemented on active PR | this canonical documentation successor |
| PR #195 | Implemented on active PR | Review-owned data-rights contributor |
| PR #198 | Implemented on active PR | Notification-owned data-rights contributor |
| PR #199 | Implemented on active PR | AI-owned data-rights contributor and additive cursor contract |
| PR #200 | Implemented on protected main | exact pinned OpenCode bootstrap allowlist repair |

No active row is shipped truth. Pending CI, draft state, unresolved review, branch movement, predecessor evidence, and merge compatibility remain independently evaluated.

## Buyer-gap state

Canonical buyer gaps remain #55, #129 and #130. Protected contributor, Calendar, and Plugin authority narrows them but does not close them. Issue #132 remains **Partial** as a verification-governance issue, not a canonical buyer-visible product gap. Issue #148 remains open until this exact documentation successor integrates. Issue #163 is completed by protected real Planning/Habit Today composition.

## Evidence hierarchy

1. protected-main source, migrations, tests, and live policy;
2. exact current active-PR source/tests labeled active;
3. accepted Architecture and ADRs;
4. canonical product/technical/data/UML/security/privacy/operability documents;
5. issues/plans/research for incomplete work;
6. historical chat, old PR bodies, old checks, and old SHAs as rationale only.

`source_head_sha`, `pr_base_snapshot_sha`, `live_base_tip_sha`, integration/synthetic identity, `workflow_checkout_sha`, `protected_main_sha`, and `release_source_sha` remain distinct. A green result never transfers across identities.

## Update rule

When maturity changes, reconcile PRD, TRD, Architecture, Data Model, UML, API, Threat Model, Privacy, Operability, Release, Standards, this index, Documentation Assessment, README/CLAUDE/CHANGELOG discoverability, and executable documentation contracts. Never promote active work before protected integration.
