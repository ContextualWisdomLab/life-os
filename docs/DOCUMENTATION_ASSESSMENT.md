# LifeOS Documentation Fitness Assessment

**Status:** Implemented on active PR

## Verdict

The historical LifeOS material is extensive but was not sufficient as one code-current whole-product authority. The project moved through materially different product models: browser-only/login-free local-first, public multi-user server persistence, a single-Docker deployment direction, and finally domain-oriented modular MSA. Protected-main implementation also continued after the first canonical documentation branch diverged.

PR #145 is the single canonical successor. Its documentation family coverage is now **design-sufficient in scope**: PRD, TRD, root Architecture, detailed ADRs, logical ERD/Data Model, UML, API/event contracts, Security, Threat Model, Privacy/Data Lifecycle, Test Strategy, Operability, Release/Migration/Rollback, Standards/Research and Requirements Traceability are present with machine-checkable consistency rules. The repository remains **protected-main documentation insufficient** until this successor is reconciled with the current live base, passes exact-current-head checks/review, and merges. Documentation sufficiency is not product or release completion.

## Fitness matrix

| Family | Assessment on this branch | Maturity | Notes |
| --- | --- | --- | --- |
| PRD | Present-current | Implemented on active PR | Product journey, historical drift, protected #146/#149 and active #147/#150/#151 are explicit |
| TRD | Present-current | Implemented on active PR | Shared runtime, service authority, data, HTTP/event, concurrency, AI/security/ops/release requirements |
| Root Architecture | Present-current on this successor | Implemented on active PR | Semantically reconciles Identity rights/integrity, durable Today, trusted calendar context, active calendar registry/plugin authority, Notification/Privacy ownership and canonical graph |
| ADR index/detailed decisions | Present-current | Implemented on active PR | ADR 0001-0010 including verification evidence identity |
| Logical ERD/Data Model | Present-current | Implemented on active PR | Service ownership and conceptual-vs-persisted status are explicit; PR #150 persistence and PR #151 non-persistence are distinguished |
| UML | Present-current | Implemented on active PR | topology, login, Today, review, calendar, AI, rights/status/integrity, plugin authority, verification evidence, backup/deployment and degraded modes |
| API/event contracts | Present-current | Implemented on active PR | Registry separates protected-main #146/#149, active #150/#151/#147 and still-partial parent gaps |
| Security | Present-current on protected main | Implemented on protected main | Root `SECURITY.md` remains vulnerability-reporting authority |
| Threat model | Present-current | Implemented on active PR | Trust boundaries and current partial/planned threats are explicit |
| Privacy/data lifecycle | Present-current | Implemented on active PR | Rights status/integrity plus active calendar/plugin authority are now separated from incomplete full lifecycles |
| Test strategy | Present-current | Implemented on active PR | Realistic DB/browser/security/concurrency and documentation-evidence policy |
| Operability | Present-current | Implemented on active PR | Deployment/readiness/observability/failure/backup/migration/release boundaries |
| Release/migration/rollback | Present-current | Implemented on active PR | Exact integrated release and state-change recovery semantics |
| Standards/research | Present-current | Implemented on active PR | Final-vs-draft distinction and APA 7 anchors; scoped feature research remains detailed evidence |
| Requirements traceability | Present-current | Implemented on active PR | Requirement/decision -> protected source or exact active PR -> remaining issue evidence |
| README/AGENTS/CLAUDE/CHANGELOG alignment | Partial | Partial | Canonical discoverability exists on the successor; protected-main integration is still pending and live root policy must be preserved semantically |
| Machine-checkable documentation consistency | Present-current on this successor | Implemented on active PR | Contract tests check required files/links/status vocabulary/ADRs/root semantic claims and current protected-vs-active maturity |

## Why file presence was not enough

The prior baseline initially treated an existing root document as current because it was newer than an older documentation donor. Semantic comparison showed that chronology was not a sufficient correctness criterion. Root documentation had to be reconciled with later Identity authentication/data-rights authority, durable Today, trusted calendar workspace context, Notification/Privacy persistence ownership and the canonical documentation graph.

The repository rule is therefore: **semantic evidence outranks file age**. A newer document is stale whenever protected-main source or accepted authority has outgrown the described contract.

## Historical drift reconciled

1. **Private/login-free local-first -> public multi-user server-backed/self-hostable:** browser-local state is draft/cache/offline state, not the system of record.
2. **Single Docker app -> modular MSA:** Compose remains a profile; service authority does not collapse.
3. **UUIDv7 proposal -> UUIDv4 protected-main invariant:** current internal IDs are opaque UUIDv4.
4. **Post-MVP labels -> evidence maturity:** capabilities are classified from live code/tests, not old roadmap labels.
5. **Configured capability maturity -> whole-product readiness:** buyer-gap exhaustion is a separate evidence dimension.
6. **Generic green check -> explicit evidence identity:** source head, PR-base snapshot, live base, synthetic merge, workflow checkout, protected main and release source are distinct authorities under ADR 0010.

## Protected-main evolution reconciled

Current protected main includes:

- durable Today synchronization (#127);
- readiness/buyer-gap accounting and bounded OpenCode hardening;
- authentication-age/recent-auth data-rights prerequisites (#134/#136/#137);
- durable data-rights request/terminal receipt persistence (#138);
- tenant-and-requesting-actor scoped request lookup (#144);
- signed trusted calendar workspace context (#139);
- authenticated non-cacheable public data-rights status resource (#146);
- per-section tenant-export integrity metadata and deterministic SHA-256 evidence (#149).

The old documentation PR #126 became materially diverged while protected work integrated and is superseded by the clean successor instead of being merged with obsolete implementation ancestry.

## Active implementation that documentation must not promote prematurely

### PR #147 — verification evidence identity

**Status:** Implemented on active PR

PR #147 advances issue #132 by separating exact contributor source-head verification from synthetic merge-tree compatibility and making evidence attribution explicit. ADR 0010 records the timeless identity model. It is not protected-main behavior until integration.

### PR #150 — calendar connection registry foundation

**Status:** Implemented on active PR

PR #150 adds the first durable calendar-connection migration/repository scoped to workspace and user, with bounded provider/account/calendar metadata, normalized scopes and opaque credential references. It does not complete issue #129's authorization callback, managed-secret, refresh/revocation, discovery/selection or migration lifecycle.

### PR #151 — plugin installation authority

**Status:** Implemented on active PR

PR #151 makes plugin installation authority explicit at the application boundary: manifest intent is separated from host-granted capabilities, exact replay is bounded, conflicting reuse fails, cross-tenant/user lookup does not disclose existence and revocation ends active authority. Durable installation/secret persistence and outbound delivery remain issue #130.

## Current product gaps that must remain explicit

- **Partial:** complete tenant export/deletion orchestration — #55, despite protected #146/#149 progress.
- **Partial:** complete per-user calendar credential lifecycle — #129, with active #150 foundation.
- **Planned/Partial by slice:** complete plugin secret/outbound delivery runtime — #130, with active #151 authority foundation.
- **Implemented on active PR:** verification evidence identity hardening — PR #147 / issue #132 until integration and residual workflow reconciliation.

## Sufficiency criteria

The documentation line is design-sufficient only when:

- every canonical family is discoverable;
- statuses use the exact vocabulary;
- ADR index/targets and required decision sections are valid;
- Mermaid/code fences are balanced;
- root Architecture and canonical documents match protected-main service ownership and implemented authority;
- active PR behavior is labeled active rather than shipped;
- requirements and buyer gaps map to source/test/issue/PR evidence;
- documentation contracts fail when semantic recency regresses, not merely when a file disappears.

The repository becomes protected-main documentation sufficient only after PR #145 passes exact-current-head CI/security/review/documentation contracts and integrates against a freshly verified live base without regressing current source/policy.

## Continuation rule

Documentation integration is a governance gate, never product-completion. After documentation work the autonomous maintenance queue immediately returns to non-documentation execution: integrate or repair #147 when policy permits, advance #150 and #151, and continue the remaining #55/#129/#130/#132 work plus subsequently discovered buyer/security/reliability/operability gaps.
