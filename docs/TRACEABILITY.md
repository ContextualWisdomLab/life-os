# LifeOS Requirements and Evidence Traceability

**Status:** Implemented on active PR  
**Baseline:** protected `main` at `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`

This file maps canonical requirements to representative source/migration/test/issue/PR evidence. It is an index, not a substitute for source control. Active-PR evidence is never protected-main evidence.

## 1. Core traceability

| Requirement | Status | Representative implementation/evidence | Open follow-up |
| --- | --- | --- | --- |
| Google/GitHub login and revocable sessions | Implemented on protected main | identity OAuth/session code and migrations | none required for current bounded login contract |
| Authentication age survives compatible session rotation | Implemented on protected main | #134, identity authentication-age migration/tests | none for this bounded prerequisite |
| Recent-auth policy for data rights | Implemented on protected main | #136/#137 and authenticated data-rights application tests | broader whole-right lifecycle #55 |
| Durable data-rights request/receipt ledger | Implemented on protected main | #138; `identity.data_rights_requests`; integration/immutability tests | contributor orchestration/delivery/retention #55 |
| Durable goals/projects/tasks | Implemented on protected main | planning migration/repository/tests | none for foundation |
| Today local action loop | Implemented on protected main | web/gateway Today behavior | durable multi-device completion #121/#127 |
| Durable Today aggregate + optimistic concurrency | Implemented on active PR | PR #127 current live branch | merge exact-head gates; issue #121 stays open until protected integration |
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
| Capability maturity separated from buyer-gap exhaustion | Implemented on protected main | #131 and current issue #21 | keep registry synchronized with real gaps |
| Repository evidence trust bound to source provenance | Implemented on protected main | #135 and readiness source | broader exact-head/merge-tree classification #132 |
| Exact contributor-head vs merge-tree evidence classification | Planned | issue #132 | implement/test across required workflows |
| Canonical PRD/TRD/ERD/UML/ADR/etc. | Implemented on active PR | this successor documentation branch/PR | merge after exact current checks/review |

## 2. Canonical buyer-gap ledger

At this baseline, live commercial-readiness evidence reports configured capability maturity separately from four unresolved canonical buyer gaps.

| Gap ID | Issue | Current state | Closest active/protected evidence |
| --- | --- | --- | --- |
| `data.portability-completion` | #55 | open / Partial | #134-#138 protected-main foundations |
| `today.multi-device-sync` | #121 | open / Implemented on active PR | PR #127 |
| `calendar.per-user-credentials` | #129 | open / Partial | PR #139 trusted-context prerequisite |
| `plugins.runtime-delivery` | #130 | open / Planned | protected-main validation/preparation only |

A 22/22 configured capability score is therefore not whole-product gap exhaustion.

## 3. Evidence hierarchy

When sources disagree, use:

1. exact current protected-main source/migrations/tests and live repository policy;
2. exact current active PR source/tests labeled as active PR;
3. accepted ADRs and root `ARCHITECTURE.md`;
4. canonical PRD/TRD/data model/UML/threat/test/operability/release docs;
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

The prior canonical documentation PR #126 accumulated a long-lived branch that diverged from protected main while #131 and #134-#138 integrated. This successor documentation branch is rebuilt from exact protected main so the canonical pack does not carry unrelated historical branch ancestry.

PR #126 must not be closed until the successor PR is opened and preservation/current-state coverage is verified.

## 6. Update procedure

When a requirement changes state:

1. refetch exact protected main and any owning active PR;
2. verify the source/migration/test evidence;
3. update PRD status and this traceability row;
4. update ADR/architecture/data/UML/threat/operability docs if authority changes;
5. update the canonical buyer-gap registry when issue ownership changes;
6. update `CHANGELOG.md` for buyer/operator-visible behavior;
7. never promote an active PR to protected-main status before merge.