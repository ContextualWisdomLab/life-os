# LifeOS Requirements and Evidence Traceability

**Status:** Implemented on active PR

Protected-main source/migrations/tests and live repository policy outrank this index. Active PR evidence is never shipped truth.

| Requirement / decision | Status | Representative evidence | Open follow-up |
| --- | --- | --- | --- |
| Login/session/workspace authority | Implemented on protected main | identity OAuth/session runtime | — |
| UUIDv4 internal IDs | Implemented on protected main | validators/migrations + ADR 0001 | — |
| Durable Goals/Projects/Tasks/Today | Implemented on protected main | planning + PR #127 | — |
| Recurring habits / review projections / reminders | Implemented on protected main | owning services/tests | — |
| Conflict-safe calendar sync | Implemented on protected main | provider adapters + #139 | — |
| Calendar connection persistence | Implemented on protected main | #150 / `1623df364925f84920c07c112f1ae96777277d20` | #129 |
| Calendar local revocation | Implemented on protected main | #153 / `b13413e571bad82535f63d478e40746d12c3e680` | provider-side revoke remains #129 |
| Calendar workspace+user signed authority | Implemented on protected main | #155 / `7b34a5a584b037653d091ea661ae4627bb5dd2ea` | public hosted disconnect/runtime #129 |
| Complete hosted calendar credential lifecycle | Partial | protected foundations above | #129 |
| Inert auditable AI proposals | Implemented on protected main | AI proposal/audit tests | — |
| Purpose-bound sensitive access | Implemented on protected main | privacy-service evidence | — |
| Recent-auth + durable rights ledger | Implemented on protected main | #134/#136/#137/#138/#144 | #55 |
| Authenticated rights status | Implemented on protected main | #146 | #55 |
| Per-section export integrity | Implemented on protected main | #149 | #55 |
| Complete export/delete orchestration | Partial | protected rights/integrity foundations | #55 |
| Plugin SDK/manifest validation | Implemented on protected main | plugin SDK/integration tests | — |
| Explicit host-owned plugin installation grants | Implemented on protected main | #151 / `6971c4e11b3204ec41526c7c959a248e54440e1c` | #130 |
| Durable plugin installation persistence | Implemented on active PR | #156; workspace-scoped repository lookup + migration | #130 secret/delivery runtime |
| Complete plugin secret/outbound delivery runtime | Partial | protected grant authority + active persistence | #130 |
| Buyer-gap vs capability-maturity separation | Implemented on protected main | readiness registry | — |
| Source/base/merge evidence attribution | Implemented on active PR | ADR 0010 + clean #154; #147 Superseded | #132 |

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
| Verification identities remain separate | Accepted architecture | ADR 0010 + #154 |
| Integration identity, metadata, secret references and grants remain separate | Accepted architecture | ADR 0011 + protected #150/#151/#153/#155 + active #156 |

## Evidence hierarchy

1. protected-main source/migrations/tests/live policy;
2. exact current active-PR source/tests labeled active;
3. accepted Architecture/ADRs;
4. canonical product/technical/data/UML/security/operability documents;
5. issues/plans/research for incomplete work;
6. historical chat/old PRs as rationale only.

`source_head_sha`, PR-base snapshot, independently resolved live-base tip, synthetic merge tree, workflow checkout, protected-main head and release source are distinct evidence identities.

## Buyer-gap state

Canonical buyer gaps remain #55, #129 and #130. Protected #146/#149 advance #55; protected #150/#153/#155 advance #129; protected #151 plus active #156 advance #130. None closes its parent gap by implication. #132 is verification reliability with clean active #154 after #147 supersession.

## Update rule

When maturity changes, reconcile PRD, this index and every materially affected ADR/Architecture/Data/UML/API/Security/Privacy/Operability view. Never promote active work to protected-main truth before integration.
