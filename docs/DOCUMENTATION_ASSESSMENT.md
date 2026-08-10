# LifeOS Documentation Fitness Assessment

**Status:** Implemented on active PR

## Verdict

Historical LifeOS material was extensive but not sufficient as one code-current whole-product authority. The project moved through materially different product models: browser-only/login-free local-first, public multi-user server persistence, a single-Docker direction, and finally domain-oriented modular MSA. Protected-main implementation also continued after the first canonical docs branch diverged.

PR #145 is the single canonical successor. Its family coverage is now **design-sufficient in scope**: PRD, TRD, root Architecture, detailed ADRs, logical ERD/Data Model, UML, API/event contracts, Security, Threat Model, Privacy/Data Lifecycle, Test Strategy, Operability, Release/Migration/Rollback, Standards/Research and Requirements Traceability exist with machine-checkable consistency rules. The repository remains **protected-main documentation insufficient** until this exact successor is current against live main, passes exact-head CI/security/review/documentation contracts, and integrates. Documentation sufficiency is never product/release completion.

## Fitness matrix

| Family | Assessment on #145 | Maturity | Notes |
| --- | --- | --- | --- |
| PRD | Present-current | Implemented on active PR | protected #146/#149/#150/#151/#153 and active #154/#155 are separated |
| TRD | Present-current | Implemented on active PR | shared runtime, authority, data, API/event, concurrency, AI/security/ops/release contracts |
| Root Architecture | Present-current | Implemented on active PR | semantically reconciled with current Identity/Today/Calendar/Plugin/Privacy/Notification and verification authority |
| ADR index / decisions | Present-current | Implemented on active PR | ADR 0001-0011 including evidence identity and external-integration authority |
| Logical ERD / Data Model | Present-current | Implemented on active PR | protected calendar persistence/revocation and non-persisted plugin logical targets distinguished |
| UML | Present-current | Implemented on active PR | topology, login, Today/review, calendar, AI, rights, plugin, verification, deployment/degraded modes |
| API/event contracts | Present-current | Implemented on active PR | protected foundations, active successors and still-partial parent gaps separated |
| Security | Present-current | Implemented on protected main | root `SECURITY.md` vulnerability-reporting authority |
| Threat model | Present-current | Implemented on active PR | trust boundaries and residual gaps explicit |
| Privacy/Data Lifecycle | Present-current | Implemented on active PR | rights, credential-reference, revocation and plugin authority boundaries distinguished |
| Test Strategy | Present-current | Implemented on active PR | realistic DB/browser/security/concurrency/evidence policy |
| Operability | Present-current | Implemented on active PR | deployment/readiness/observability/failure/backup/recovery boundaries |
| Release/Migration/Rollback | Present-current | Implemented on active PR | one exact integrated release-source contract |
| Standards/Research | Present-current | Implemented on active PR | source-class/final-vs-draft discipline and APA 7 anchors |
| Requirements Traceability | Present-current | Implemented on active PR | requirement/decision -> protected source or exact active PR -> remaining issue |
| README/AGENTS/CLAUDE/CHANGELOG alignment | Partial | Partial | discoverability exists on successor; protected-main integration is still pending |
| Machine-checkable documentation consistency | Present-current | Implemented on active PR | semantic currentness, status vocabulary, ADRs, links, lifecycle maturity and evidence identity are gated |

## Historical drift reconciled

1. **Private/login-free local-first -> public multi-user server-backed/self-hostable.** Browser-local state is explicit draft/cache/offline state.
2. **Single Docker application -> modular MSA.** Compose remains a profile, not authority collapse.
3. **UUIDv7 -> UUIDv4.** Internal product IDs are opaque UUIDv4.
4. **Old post-MVP labels -> evidence maturity.** Protected source/tests outrank roadmap prose.
5. **Capability maturity -> buyer-gap exhaustion.** These are independent evidence dimensions.
6. **Generic green status -> explicit evidence identity.** ADR 0010 separates source head, PR-base snapshot, live base, merge tree, workflow checkout, protected main and release source.
7. **External integration metadata -> ambient authority.** ADR 0011 separates LifeOS identity, provider/plugin metadata, secret references and explicit capability grants.

## Protected-main evolution currently represented

Protected main includes durable Today (#127), trusted calendar workspace context (#139), recent-auth/data-rights prerequisites (#134/#136/#137), durable rights ledger (#138), tenant+actor status lookup (#144), authenticated public rights status (#146), export integrity evidence (#149), workspace+user calendar connection persistence (#150), explicit plugin installation grants (#151), migration-fixture reliability repair (#152), and atomic calendar connection revocation (#153).

The old documentation PR #126 is superseded. It is not evidence merely because historical review threads were once resolved.

## Active work represented without promotion

### PR #154 — verification evidence identity

**Status:** Implemented on active PR

Clean successor #154 replaces superseded #147. It separates exact contributor-head checks from synthetic merge compatibility, binds AppGuardrail SARIF to the analyzed source identity, obtains current source/live-base evidence through authenticated GitHub API calls, retains merge parents for verification and rejects identity mismatch. Issue #132 remains open until integration/residual workflow attribution closes.

### PR #155 — calendar workspace+user authority

**Status:** Implemented on active PR

PR #155 adds the distinct short-lived `life-os.calendar-user.v1` authority context that binds both workspace and requesting user. It is a prerequisite for hosted user-sensitive calendar operations, not evidence that public disconnect/OAuth/managed-secret/refresh/provider-revocation/discovery are complete.

## Remaining product gaps

- **Partial:** #55 complete export/deletion orchestration, despite protected #146/#149.
- **Partial:** #129 complete per-user calendar credential lifecycle, despite protected #150/#153 and active #155.
- **Partial:** #130 complete plugin secret/outbound-delivery runtime, despite protected #151 installation authority.
- **Implemented on active PR:** #132 verification-evidence attribution via #154 until protected integration/residual closure.

## Sufficiency criteria

The documentation line is design-sufficient only when canonical families are discoverable, statuses use exact vocabulary, ADR targets/sections are valid, diagrams are balanced, root Architecture matches protected service authority, active behavior is not called shipped, requirements/gaps map to executable evidence, and semantic-regression tests fail when currentness drifts.

The repository is protected-main documentation sufficient only after PR #145 passes current exact-head checks/security/review and integrates against a freshly resolved live base without regressing current source/policy.

## Continuation rule

Documentation completion is a governance gate only. The autonomous queue must continue #154/#155 and the remaining #55/#129/#130/#132 work, plus newly discovered buyer/security/reliability/operability gaps, rather than stopping on a green documentation pack.
