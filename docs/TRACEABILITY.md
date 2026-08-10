# LifeOS Requirements and Evidence Traceability

**Status:** Implemented on active PR

This index maps product requirements and durable decisions to representative source/test/issue evidence. Protected-main source/migrations/tests outrank this index when evidence conflicts.

| Requirement / decision | Status | Representative implementation/evidence | Open follow-up |
| --- | --- | --- | --- |
| PRD-ID-001 login/session/workspace authority | Implemented on protected main | identity OAuth/session runtime and tests | — |
| PRD-ID-002 UUIDv4 internal IDs | Implemented on protected main | `AGENTS.md`, validators/migrations | — |
| PRD-PLAN-001 durable planning | Implemented on protected main | planning PostgreSQL repository/migrations | — |
| PRD-PLAN-002 durable Today synchronization | Implemented on protected main | PR #127; Today aggregate, BFF, PostgreSQL concurrency and browser acceptance | — |
| PRD-HAB-001 recurring habits | Implemented on protected main | habit service/domain/PostgreSQL tests | — |
| PRD-REV-001 review projection boundary | Implemented on protected main | review service tests | — |
| PRD-CAL-001 conflict-safe calendar sync | Implemented on protected main | CalDAV/Google adapter tests | — |
| PRD-CAL-002 trusted calendar workspace context | Implemented on protected main | PR #139; signed context verifier/controller regressions | — |
| PRD-CAL-003 complete hosted per-user calendar credentials | Partial | provider adapters and trusted workspace context exist | issue #129 |
| PRD-CAL-004 tenant+user calendar connection registry foundation | Implemented on active PR | PR #150; service-owned migration/repository with opaque credential references | issue #129 remains for complete lifecycle |
| PRD-NOT-001 bounded reminders | Implemented on protected main | notification scheduler/persistence tests | — |
| PRD-AI-001 inert auditable proposals | Implemented on protected main | AI proposal/audit service tests | — |
| PRD-AI-002 deterministic/live-provider separation | Implemented on protected main | proposal evaluator + NIM conformance workflow | — |
| PRD-PRIV-001 purpose-bound sensitive access | Implemented on protected main | privacy-service grants/events/tests | — |
| PRD-PRIV-002 data-rights auth/request ledger primitives | Implemented on protected main | PRs #134, #136, #137, #138, #144 | issue #55 for whole journey |
| PRD-PRIV-003 complete export/delete orchestration | Partial | identity core exists; full domain/reconciliation/delivery incomplete | issue #55 |
| PRD-PRIV-004 authenticated bounded request-status resource | Implemented on protected main | PR #146; session-derived tenant/actor scope, bounded public projection and non-cacheable responses | issue #55 remains for whole-right completion |
| PRD-PRIV-005 per-section export integrity evidence | Implemented on protected main | PR #149; safe record counts, deterministic section SHA-256 and whole-export digest | issue #55 remains for delivery/reconciliation completion |
| PRD-INT-001 plugin SDK/validation | Implemented on protected main | plugin SDK/integration-service tests | — |
| PRD-INT-002 complete plugin secret/delivery runtime | Planned | validation-only surface is intentionally non-runtime | issue #130 |
| PRD-INT-003 explicit tenant-scoped plugin installation grants | Implemented on active PR | PR #151; bounded application authority, replay/conflict/revocation semantics | issue #130 remains for durable secret/delivery runtime |
| PRD-WEB-001 accessible localized PWA | Implemented on protected main | browser/accessibility/localization tests | — |
| PRD-OPS-001 backup/restore | Implemented on protected main | backup scripts/tests/runbook | — |
| PRD-GOV-001 buyer-gap vs capability maturity separation | Implemented on protected main | repository buyer-gap registry; issue #21 rendering | — |
| PRD-GOV-002 exact source/base/merge verification attribution | Implemented on active PR | ADR 0010; PR #147 separates contributor source-head verification from synthetic merge compatibility | issue #132 remains until protected-main integration and residual workflow attribution is reconciled |

## Architecture decisions

| Decision | Status | Evidence |
| --- | --- | --- |
| Multi-user server-backed/self-hostable MSA supersedes browser-only primary architecture | Accepted architecture | `ARCHITECTURE.md`, service layout, Compose/Kubernetes |
| UUIDv4 supersedes original UUIDv7 proposal | Accepted architecture | protected-main `AGENTS.md` and code/migrations |
| Service-owned persistence; no cross-service table authority | Accepted architecture | `ARCHITECTURE.md`, per-service repositories/migrations |
| AI output remains inert proposal evidence | Accepted architecture | AI service tests and architecture |
| Sensitive access is purpose/resource/lifetime/audit bound | Accepted architecture | privacy-service tests |
| Capability maturity cannot stand in for buyer-gap exhaustion | Accepted architecture | buyer-gap registry/reporting |
| Canonical documentation must distinguish shipped/active/planned/superseded state | Accepted architecture | ADR 0007 and documentation contract tests on PR #145 |
| Verification evidence identities remain separate | Accepted architecture | ADR 0010; PR #147 is active implementation evidence |

## Evidence hierarchy

1. Current protected-main source, migrations, tests and live repository policy.
2. Current active PR source/tests, explicitly labeled active and bound to its exact head.
3. Accepted architecture/ADR decisions.
4. Canonical PRD/TRD/Data Model/UML/Security/Test/Operability docs.
5. Issues/plans/research for incomplete work.
6. Historical chat/PR bodies only as rationale.

A contributor source head, PR-base snapshot, independently resolved live base tip, synthetic merge tree, workflow checkout, protected-main head and release source are distinct evidence identities. Evidence is never promoted to another identity just because the status name is green.

## Buyer gaps from live readiness state

The configured capability set can be fully mature while the product still has accepted buyer gaps. Current canonical open buyer gaps are #55 data portability completion, #129 per-user calendar credentials, and #130 plugin runtime delivery. Protected-main #146 and #149 materially advance #55 without closing it. Active PR #150 advances #129 and active PR #151 advances #130 without promoting either whole gap to shipped completion. Issue #132 is a reliability/governance hardening gap; PR #147 is its active implementation line.

## Update rule

Whenever a requirement changes maturity, update PRD status, this traceability row, relevant ADR/architecture/data/UML/security/operability views, regression evidence and CHANGELOG. Never label active/unmerged work `Implemented on protected main`.
