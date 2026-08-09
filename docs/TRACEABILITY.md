# LifeOS Requirements and Evidence Traceability

**Status:** Implemented on active PR  
**Baseline:** protected `main` at `f4cae6d83eadb00019d2962a650c55c59a3349ae`

This file maps canonical requirements to representative source/migration/test/issue/PR evidence. It is an index, not a substitute for source control. Active-PR evidence is never protected-main evidence.

## 1. Core traceability

| Requirement | Status | Representative implementation/evidence | Open follow-up |
| --- | --- | --- | --- |
| Google/GitHub login and revocable sessions | Implemented on protected main | identity OAuth/session code and migrations | none required for current bounded login contract |
| Authentication age survives compatible session rotation | Implemented on protected main | #134, identity authentication-age migration/tests | none for this bounded prerequisite |
| Recent-auth policy for data rights | Implemented on protected main | #136/#137 and authenticated data-rights application tests | broader whole-right lifecycle #55 |
| Durable data-rights request/receipt ledger | Implemented on protected main | #138; `identity.data_rights_requests`; integration/immutability tests | contributor orchestration/delivery/retention #55 |
| Durable goals/projects/tasks | Implemented on protected main | planning migration/repository/tests | none for foundation |
| Durable Today aggregate + optimistic multi-device sync | Implemented on protected main | PR #127 merged as `f4cae6d83eadb00019d2962a650c55c59a3349ae`; issue #121 closed completed | none for the accepted bounded slice |
| Recurring habit + completion history | Implemented on protected main | habit service migration/domain/tests | none for current bounded core |
| Guided review | Implemented on protected main | review service migration/tests | future product expansion separate |
| Durable reminder inbox/scheduler | Implemented on protected main | notification migration/runtime/tests | none for current bounded reminder core |
| Conflict-safe CalDAV/Google provider adapter | Implemented on protected main | calendar integration service/tests | hosted credential lifecycle #129 |
| Calendar trusted workspace context | Implemented on active PR | PR #139 | full connection/credential lifecycle #129 |
| Per-user encrypted calendar credentials/provider selection | Partial | conflict-safe adapter exists; trusted-context PR active | issue #129 |
| Inert auditable AI proposals | Implemented on protected main | AI proposal/audit migration/service/tests | future capability only after evidence |
| Deterministic proposal-quality + bounded NIM conformance | Implemented on protected main | AI evaluator/live workflow and OpenCode/model hardening | provider availability remains separate evidence |
| Purpose-bound sensitive-data access | Implemented on protected main | privacy service migration/tests | keep lifecycle and policy current |
| Plugin contract validation/preparation | Implemented on protected main | plugin SDK/integration service | runtime installation/secrets/delivery #130 |
| Plugin installation/secret/outbound delivery runtime | Planned | no protected-main runtime claim | issue #130 |
| Backup/restore logical recovery tier | Implemented on protected main | `infra/backup/` tests/runbook | PITR/operator retention explicitly outside upstream tier |
| Provider-neutral Kubernetes reference | Implemented on protected main | `infra/kubernetes/` and deployment tests/runbook | operator-owned platform dependencies remain external |
| Capability maturity separated from buyer-gap exhaustion | Implemented on protected main | #131; issue #21 now reports 22/22 maturity and three unresolved gaps | keep registry synchronized with live issue state |
| Repository evidence trust bound to source provenance | Implemented on protected main | #135 and readiness source | broader exact-head/merge-tree classification #132 |
| Exact contributor-head vs merge-tree evidence classification | Planned | issue #132 | implement/test across required workflows |
| Canonical PRD/TRD/ERD/UML/ADR/etc. | Implemented on active PR | successor PR #140 | reconcile live base and merge only after exact-head validation/review |

## 2. Canonical buyer-gap ledger

The repository-owned registry retains durable gap identities even after an issue resolves. The commercial-readiness report reconciles current issue state and, at `f4cae6d...`, reports three unresolved canonical gaps because #121 is closed completed.

| Gap ID | Issue | Live issue state | Product status |
| --- | --- | --- | --- |
| `data.portability-completion` | #55 | open | Partial |
| `today.multi-device-sync` | #121 | closed completed | Implemented on protected main |
| `calendar.per-user-credentials` | #129 | open | Partial |
| `plugins.runtime-delivery` | #130 | open | Planned |

A 22/22 configured capability score is therefore not whole-product gap exhaustion, but a resolved registered gap is also not kept artificially unresolved.

## 3. Evidence hierarchy

When sources disagree, use:

1. exact current protected-main source/migrations/tests and live repository policy;
2. exact current active PR source/tests labeled as active PR;
3. accepted ADRs and root `ARCHITECTURE.md`;
4. canonical PRD/TRD/data model/UML/threat/test/operability docs;
5. repository-owned capability/buyer-gap registry and current generated report;
6. scoped runbooks/research/specs/plans;
7. historical PRs, old branches and conversation as rationale only.

## 4. Historical supersession traceability

| Historical choice | Current status | Current evidence |
| --- | --- | --- |
| login-free browser-only primary product | Superseded | identity/workspace/PostgreSQL/multi-device server architecture |
| private repository/personal-only software | Superseded | public open-source/self-hostable product boundary |
| single-Docker primary architecture | Superseded | domain-oriented services; Compose remains deployment profile |
| UUIDv7 internal identity proposal | Superseded | UUIDv4 architecture/migrations/validators |
| calendar as post-MVP-only concept | Superseded | provider adapters are protected-main; hosted credential lifecycle remains partial |
| AI as unconstrained planner/agent authority | Superseded | inert proposal + explicit decision boundary |
| capability maturity equals zero buyer gaps | Superseded | #131 separate evidence dimensions |

## 5. Documentation integration status

The prior canonical documentation PR #126 accumulated a long-lived branch that diverged from protected main while major product/governance slices integrated. PR #140 is the clean successor. It began from then-current protected main, and this traceability has now been reconciled after the subsequent #127 merge.

PR #126 must not be closed until #140 is current against live main, preserves required unique canonical content, and is reviewable under exact-head checks.

## 6. Update procedure

When a requirement changes state:

1. refetch exact protected main and any owning active PR;
2. verify source/migration/test and live issue evidence;
3. update PRD status and this traceability row;
4. update ADR/architecture/data/UML/threat/operability docs if authority changes;
5. keep the durable buyer-gap registry but allow live closed/resolved state to clear unresolved-gap reporting;
6. update `CHANGELOG.md` for buyer/operator-visible behavior;
7. never promote an active PR to protected-main status before merge.