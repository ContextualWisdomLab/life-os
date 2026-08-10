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
| PRD-CAL-003 per-user hosted calendar credentials | Partial | development/provider adapters exist | issue #129 |
| PRD-NOT-001 bounded reminders | Implemented on protected main | notification scheduler/persistence tests | — |
| PRD-AI-001 inert auditable proposals | Implemented on protected main | AI proposal/audit service tests | — |
| PRD-AI-002 deterministic/live-provider separation | Implemented on protected main | proposal evaluator + NIM conformance workflow | — |
| PRD-PRIV-001 purpose-bound sensitive access | Implemented on protected main | privacy-service grants/events/tests | — |
| PRD-PRIV-002 data-rights auth/request ledger primitives | Implemented on protected main | PRs #134, #136, #137, #138, #144 | issue #55 for whole journey |
| PRD-PRIV-003 complete export/delete orchestration | Partial | identity core exists; full domain/reconciliation/delivery incomplete | issue #55 |
| PRD-INT-001 plugin SDK/validation | Implemented on protected main | plugin SDK/integration-service tests | — |
| PRD-INT-002 plugin runtime last mile | Planned | validation-only surface is intentionally non-runtime | issue #130 |
| PRD-WEB-001 accessible localized PWA | Implemented on protected main | browser/accessibility/localization tests | — |
| PRD-OPS-001 backup/restore | Implemented on protected main | backup scripts/tests/runbook | — |
| PRD-GOV-001 buyer-gap vs capability maturity separation | Implemented on protected main | repository buyer-gap registry; issue #21 rendering | — |
| PRD-GOV-002 exact source-head verification attribution | Planned | current workflows have mixed evidence classes | issue #132 |

## Architecture decisions

| Decision | Status | Evidence |
| --- | --- | --- |
| Multi-user server-backed/self-hostable MSA supersedes browser-only primary architecture | Accepted architecture | `ARCHITECTURE.md`, service layout, Compose/Kubernetes |
| UUIDv4 supersedes original UUIDv7 proposal | Accepted architecture | protected-main `AGENTS.md` and code/migrations |
| Service-owned persistence; no cross-service table authority | Accepted architecture | `ARCHITECTURE.md`, per-service repositories/migrations |
| AI output remains inert proposal evidence | Accepted architecture | AI service tests and architecture |
| Sensitive access is purpose/resource/lifetime/audit bound | Accepted architecture | privacy-service tests |
| Capability maturity cannot stand in for buyer-gap exhaustion | Accepted architecture | buyer-gap registry/reporting |
| Canonical documentation must distinguish shipped/active/planned/superseded state | Accepted architecture | this documentation line + contract tests on this PR |

## Evidence hierarchy

1. Current protected-main source, migrations, tests and live repository policy.
2. Accepted architecture/ADR decisions.
3. Canonical PRD/TRD/Data Model/UML/Security/Test/Operability docs.
4. Current active PR evidence explicitly labeled as active.
5. Issues/plans/research for incomplete work.
6. Historical chat/PR bodies only as rationale.

## Buyer gaps from live readiness state

The configured capability set can be fully mature while the product still has accepted buyer gaps. Current canonical open buyer gaps are #55 data portability completion, #129 per-user calendar credentials, and #130 plugin runtime delivery. Issue #132 is a reliability/governance hardening gap for verification identity rather than a buyer capability row.

## Update rule

Whenever a requirement changes maturity, update PRD status, this traceability row, relevant ADR/architecture/data/UML/security/operability views, regression evidence and CHANGELOG. Never label active/unmerged work `Implemented on protected main`.