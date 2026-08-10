# LifeOS Requirements and Evidence Traceability

**Status:** Implemented on active PR

Protected-main source/migrations/tests and live repository policy outrank this index. Active PR evidence is never shipped truth.

| Requirement / decision | Status | Representative evidence | Open follow-up |
| --- | --- | --- | --- |
| PRD-ID-001 login/session/workspace authority | Implemented on protected main | identity OAuth/session runtime | — |
| PRD-ID-002 opaque UUIDv4 internal IDs | Implemented on protected main | validators/migrations + ADR 0001 | — |
| PRD-PLAN-001 durable Goals/Projects/Tasks | Implemented on protected main | planning repository/migrations | — |
| PRD-PLAN-002 durable Today synchronization | Implemented on protected main | PR #127 + concurrency/browser evidence | — |
| PRD-HAB-001 recurring habits | Implemented on protected main | habit service persistence/tests | — |
| PRD-REV-001 review projection boundary | Implemented on protected main | review-service tests | — |
| PRD-CAL-001 conflict-safe calendar sync | Implemented on protected main | provider adapters | — |
| PRD-CAL-002 trusted workspace calendar context | Implemented on protected main | PR #139 | — |
| PRD-CAL-003 complete hosted per-user calendar credential lifecycle | Partial | protected foundations below | issue #129 |
| PRD-CAL-004 workspace+user calendar connection persistence | Implemented on protected main | PR #150 / `1623df364925f84920c07c112f1ae96777277d20` | #129 |
| PRD-CAL-005 atomic tenant+user calendar connection revocation | Implemented on protected main | PR #153 / `b13413e571bad82535f63d478e40746d12c3e680` | provider-side revoke remains #129 |
| PRD-CAL-006 signed workspace+user calendar authority | Implemented on protected main | PR #155 / `7b34a5a584b037653d091ea661ae4627bb5dd2ea` | hosted connection/disconnect runtime #129 |
| PRD-NOT-001 bounded reminders | Implemented on protected main | notification persistence/scheduler tests | — |
| PRD-AI-001 inert auditable proposals | Implemented on protected main | AI proposal/audit tests | — |
| PRD-AI-002 deterministic/live-provider separation | Implemented on protected main | proposal evaluator + bounded live conformance | — |
| PRD-PRIV-001 purpose-bound sensitive access | Implemented on protected main | privacy-service evidence | — |
| PRD-PRIV-002 recent-auth + durable rights request ledger | Implemented on protected main | #134/#136/#137/#138/#144 | #55 |
| PRD-PRIV-003 complete export/delete orchestration | Partial | protected rights/integrity foundations exist | #55 |
| PRD-PRIV-004 authenticated bounded rights status | Implemented on protected main | PR #146 | #55 |
| PRD-PRIV-005 per-section export integrity evidence | Implemented on protected main | PR #149 | #55 |
| PRD-INT-001 plugin SDK/manifest validation | Implemented on protected main | plugin SDK/integration tests | — |
| PRD-INT-002 complete plugin secret/outbound delivery runtime | Partial | protected grant authority + active durable persistence | #130 |
| PRD-INT-003 explicit tenant-scoped plugin installation grants | Implemented on protected main | PR #151 / `6971c4e11b3204ec41526c7c959a248e54440e1c` | #130 |
| PRD-INT-004 durable plugin installation persistence | Implemented on active PR | PR #156; workspace+installing-user-scoped migration/repository | #130 secret/delivery runtime |
| PRD-WEB-001 accessible localized PWA | Implemented on protected main | browser/accessibility/localization tests | — |
| PRD-OPS-001 backup/restore | Implemented on protected main | backup scripts/tests/runbook | — |
| PRD-OPS-002 provider-neutral deployment/readiness/metrics | Implemented on protected main | infra/observability tests | — |
| PRD-GOV-001 buyer-gap vs capability-maturity separation | Implemented on protected main | readiness registry | — |
| PRD-GOV-002 exact source/live-base/integration evidence attribution | Implemented on protected main | ADR 0010 + PR #154 merged as `2c272a404f8f3a74aa5796a1957d4a6ce0fabe8f`; #147 Superseded | #132 remains for residual central scanner evidence classification |

## Architecture decisions

| Decision | Status | Evidence |
| --- | --- | --- |
| Server-backed self-hostable MSA supersedes browser-only primary architecture | Accepted architecture | Architecture + ADR 0009 |
| UUIDv4 supersedes UUIDv7 | Accepted architecture | ADR 0001 |
| Service-owned persistence/no cross-table authority | Accepted architecture | ADR 0003 |
| AI remains inert proposal evidence | Accepted architecture | ADR 0004 |
| Purpose-bound sensitive access | Accepted architecture | ADR 0005 |
| Capability maturity != buyer-gap exhaustion | Accepted architecture | ADR 0008 |
| Canonical documentation uses explicit maturity | Accepted architecture | ADR 0007 |
| Verification identities remain separate | Accepted architecture | ADR 0010 + protected PR #154 |
| Integration identity, metadata, secret references and grants remain separate | Accepted architecture | ADR 0011 + protected #150/#151/#153/#155 + active #156 |
| Test-time compute and model-assisted development authority remain evidence-driven and separate from review/merge/release authority | Accepted architecture | ADR 0012 + protected `AGENTS.md` + live-conformance design + Fugu/Conductor/TRINITY/strong-single-agent evidence |

## Evidence hierarchy

1. protected-main source/migrations/tests/live policy;
2. exact current active-PR source/tests labeled active;
3. accepted Architecture/ADRs;
4. canonical product/technical/data/UML/security/operability documents;
5. issues/plans/research for incomplete work;
6. historical chat/old PRs as rationale only.

`source_head_sha`, `pr_base_snapshot_sha`, `live_base_tip_sha`, integration/synthetic tree identity, workflow checkout identity, protected-main head and release source are distinct evidence authorities. A green result never transfers from one identity to another.

## Buyer-gap state

Canonical buyer gaps remain #55, #129 and #130. Protected #146/#149 advance #55; protected #150/#153/#155 advance #129; protected #151 plus active #156 advance #130. None closes its parent gap by implication. Issue #132 is now a narrower verification-governance gap: protected #154 fixed LifeOS source/live-base/integration evidence separation, while residual central SAST/Security scanner checkout/attribution taxonomy still requires auditable classification.

## Update rule

When maturity changes, reconcile PRD, this index and every materially affected ADR/Architecture/Data/UML/API/Security/Privacy/Operability view. Never promote active work to protected-main truth before integration.
