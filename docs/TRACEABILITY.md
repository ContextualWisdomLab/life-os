# LifeOS Requirements and Evidence Traceability

**Status:** Implemented on active PR

This index maps canonical requirements and durable decisions to representative source/test/issue/PR evidence. Current protected-main source, migrations, tests and live repository policy outrank this index when evidence conflicts.

| Requirement / decision | Status | Representative implementation/evidence | Open follow-up |
| --- | --- | --- | --- |
| PRD-ID-001 login/session/workspace authority | Implemented on protected main | identity OAuth/session runtime and tests | — |
| PRD-ID-002 opaque UUIDv4 internal IDs | Implemented on protected main | `AGENTS.md`, validators/migrations | — |
| PRD-PLAN-001 durable planning | Implemented on protected main | planning PostgreSQL repository/migrations | — |
| PRD-PLAN-002 durable Today synchronization | Implemented on protected main | PR #127; Today aggregate, BFF, PostgreSQL concurrency and browser acceptance | — |
| PRD-HAB-001 recurring habits | Implemented on protected main | habit service/domain/PostgreSQL tests | — |
| PRD-REV-001 review projection boundary | Implemented on protected main | review service tests | — |
| PRD-CAL-001 conflict-safe calendar sync | Implemented on protected main | CalDAV/Google adapter tests | — |
| PRD-CAL-002 trusted workspace calendar context | Implemented on protected main | PR #139 | — |
| PRD-CAL-003 complete hosted per-user calendar credential lifecycle | Partial | protected trusted context, connection registry and local revocation foundations exist | issue #129 |
| PRD-CAL-004 workspace+user calendar connection registry | Implemented on protected main | PR #150 / `1623df364925f84920c07c112f1ae96777277d20` | issue #129 remains for complete lifecycle |
| PRD-CAL-005 atomic tenant+user calendar connection revocation | Implemented on protected main | PR #153 / `b13413e571bad82535f63d478e40746d12c3e680` | provider-side OAuth revocation remains #129 |
| PRD-CAL-006 signed workspace+user calendar authority | Implemented on active PR | PR #155; distinct short-lived `life-os.calendar-user.v1` authority | subsequent #129 disconnect/runtime slices |
| PRD-NOT-001 bounded reminders | Implemented on protected main | notification scheduler/persistence tests | — |
| PRD-AI-001 inert auditable proposals | Implemented on protected main | AI proposal/audit tests | — |
| PRD-AI-002 deterministic/live-provider separation | Implemented on protected main | proposal evaluator + bounded NIM conformance | — |
| PRD-PRIV-001 purpose-bound sensitive access | Implemented on protected main | privacy-service grants/events/tests | — |
| PRD-PRIV-002 recent-auth + durable rights request ledger | Implemented on protected main | #134/#136/#137/#138/#144 | issue #55 for whole journey |
| PRD-PRIV-003 complete export/delete orchestration | Partial | protected identity/integrity foundations exist; full contributor/reconciliation/delivery lifecycle incomplete | issue #55 |
| PRD-PRIV-004 authenticated bounded request-status resource | Implemented on protected main | PR #146 | issue #55 remains for whole-right completion |
| PRD-PRIV-005 per-section export integrity evidence | Implemented on protected main | PR #149 | issue #55 remains for protected delivery/reconciliation |
| PRD-INT-001 plugin SDK/validation | Implemented on protected main | plugin SDK/integration-service tests | — |
| PRD-INT-002 complete plugin secret/delivery runtime | Partial | protected host-owned installation authority exists; durable secret/delivery runtime incomplete | issue #130 |
| PRD-INT-003 explicit tenant-scoped installation grants | Implemented on protected main | PR #151 / `6971c4e11b3204ec41526c7c959a248e54440e1c` | issue #130 for persistent secrets/delivery |
| PRD-WEB-001 accessible localized PWA | Implemented on protected main | browser/accessibility/localization tests | — |
| PRD-OPS-001 backup/restore | Implemented on protected main | backup scripts/tests/runbook | — |
| PRD-GOV-001 buyer-gap vs capability-maturity separation | Implemented on protected main | buyer-gap registry / issue #21 report | — |
| PRD-GOV-002 exact source/base/merge verification attribution | Implemented on active PR | ADR 0010; clean successor PR #154; old #147 superseded | issue #132 until integration/residual attribution closure |

## Architecture decisions

| Decision | Status | Evidence |
| --- | --- | --- |
| Multi-user server-backed/self-hostable MSA supersedes browser-only primary architecture | Accepted architecture | `ARCHITECTURE.md`, service layout, Compose/Kubernetes |
| UUIDv4 supersedes original UUIDv7 proposal | Accepted architecture | protected-main code/migrations + ADR 0001 |
| Service-owned persistence; no cross-service table authority | Accepted architecture | root Architecture + ADR 0003 |
| AI output remains an inert proposal | Accepted architecture | AI tests + ADR 0004 |
| Sensitive access is actor/workspace/resource/purpose/lifetime bound | Accepted architecture | privacy tests + ADR 0005 |
| Capability maturity cannot stand in for buyer-gap exhaustion | Accepted architecture | ADR 0008 + readiness registry |
| Canonical docs distinguish shipped/active/planned/superseded truth | Accepted architecture | ADR 0007 + documentation contract tests |
| Verification evidence identities remain separate | Accepted architecture | ADR 0010 + PR #154 active implementation |
| Integration identity, external metadata, secret references and granted authority remain separate | Accepted architecture | ADR 0011 + protected #150/#151/#153 + active #155 |

## Evidence hierarchy

1. Current protected-main source, migrations, tests and live repository policy.
2. Exact current active-PR source/tests, explicitly labeled active.
3. Accepted Architecture/ADR decisions.
4. Canonical PRD/TRD/Data Model/UML/API/Security/Test/Operability documents.
5. Open issues/plans/research for incomplete work.
6. Historical chat/PR bodies only as rationale.

`source_head_sha`, PR-base snapshot, independently resolved live-base tip, synthetic merge tree, workflow checkout, protected-main head and release source are distinct evidence identities. A green status never transfers authority across them.

## Buyer-gap state

Canonical buyer gaps remain #55 data portability completion, #129 hosted per-user calendar credentials, and #130 plugin runtime delivery. Protected #146/#149 advance #55; protected #150/#153 and active #155 advance #129; protected #151 advances #130. None of those bounded slices closes the parent gap by implication. Issue #132 is verification/governance reliability; #154 is its clean active implementation after #147 was superseded.

## Update rule

Whenever maturity changes, reconcile PRD, this traceability index, relevant ADR/Architecture/Data/UML/API/Security/Privacy/Operability views, regression evidence and CHANGELOG. Never label active/unmerged work `Implemented on protected main`.
