# LifeOS Documentation Fitness Assessment

**Status:** Implemented on active PR

## Verdict

The historical LifeOS material is extensive but was not sufficient as one code-current whole-product authority. The project moved through materially different product models: browser-only/login-free local-first, public multi-user server persistence, a single-Docker deployment direction, and finally domain-oriented modular MSA. Protected-main implementation also continued after the first canonical documentation branch diverged.

PR #145 is the single clean current-main canonical successor. Its scope is **design-sufficient** when its semantic documentation contracts are green because it contains the required product, technical, architecture, ADR, logical ERD, UML, API/event, security/privacy, test, operability, release and traceability families. The repository remains **protected-main documentation insufficient** until this successor passes its own current-head checks/review and merges. Documentation sufficiency is not product or release completion.

## Fitness matrix

| Family | Assessment on this branch | Maturity | Notes |
| --- | --- | --- | --- |
| PRD | Present-current | Implemented on active PR | Product journey, historical drift, live gaps, #146 and #147 active slices are explicit |
| TRD | Present-current | Implemented on active PR | Bounded contexts, authority, data, HTTP/event, concurrency, AI/security/ops/release requirements |
| Root Architecture | Present-current on this successor | Implemented on active PR | Semantic recency repair now includes Identity authentication/data-rights authority, durable Today, trusted calendar context, Notification/Privacy ownership, AI/plugin boundaries and the canonical graph; protected main still has the older root document until #145 merges |
| ADR index/detailed decisions | Present-current | Implemented on active PR | ADR 0001-0010, including verification evidence identity, are indexed under `docs/adr/` |
| Logical ERD/Data Model | Present-current | Implemented on active PR | Service ownership and conceptual-vs-persisted status are explicit; migrations remain physical truth |
| UML | Present-current | Implemented on active PR | topology, login, Today, review, calendar, AI, rights/status, verification evidence, backup, deployment and degraded modes |
| API/event contracts | Present-current | Implemented on active PR | Repository contract registry separates protected-main request ledger, active #146 public status, and active #147 verification evidence |
| Security | Present-current on protected main | Implemented on protected main | Root `SECURITY.md` remains vulnerability-reporting authority |
| Threat model | Present-current | Implemented on active PR | Trust boundaries and current partial/planned threats are explicit |
| Privacy/data lifecycle | Present-current | Implemented on active PR | Data classes, purpose-bound access, data-rights/calendar/plugin lifecycle |
| Test strategy | Present-current | Implemented on active PR | Realistic DB/browser/security/concurrency and documentation-evidence policy |
| Operability | Present-current | Implemented on active PR | Deployment/readiness/observability/failure/backup/migration/release boundaries |
| Release/migration/rollback | Present-current | Implemented on active PR | Exact integrated release and state-change recovery semantics |
| Standards/research | Present-current | Implemented on active PR | Final-vs-draft distinction and APA 7 anchors; scoped feature research remains detailed evidence |
| Requirements traceability | Present-current | Implemented on active PR | Requirement/decision -> source/test/issue/PR evidence |
| README/AGENTS/CLAUDE/CHANGELOG alignment | Partial | Partial | Discoverability is improved but protected-main integration has not occurred; root policies must remain semantically reconciled rather than copied by chronology |
| Machine-checkable documentation consistency | Present-current on this successor | Implemented on active PR | `documentation-contract.test.mjs` now checks required files/links, exact status vocabulary, ADR 0010, semantic root-Architecture claims, active PR #146/#147 traceability and source-vs-merge terminology |

## Why file presence was not enough

The prior baseline initially treated the existing root `ARCHITECTURE.md` as current because it was already on a newer protected-main commit than an older documentation donor. Semantic comparison showed that was wrong: the root file omitted later protected-main Identity authentication provenance/data-rights authority, durable Today, trusted calendar workspace context, Notification/Privacy persistence ownership and the canonical documentation graph.

The correction is a repository rule: **semantic evidence outranks file age**. A newer root document can still be stale if protected-main source has outgrown its described authority.

## Historical drift reconciled

1. **Private/login-free local-first -> public multi-user server-backed/self-hostable:** browser-local state is draft/cache/offline state, not the system of record.
2. **Single Docker app -> modular MSA:** Compose remains a profile; service authority does not collapse.
3. **UUIDv7 proposal -> UUIDv4 protected-main invariant:** current internal IDs are opaque UUIDv4.
4. **Post-MVP labels -> evidence maturity:** capabilities are classified from live code/tests, not old roadmap labels.
5. **Configured capability maturity -> whole-product readiness:** buyer-gap exhaustion is a separate evidence dimension.
6. **Generic green check -> explicit evidence identity:** source head, PR-base snapshot, live base, synthetic merge, workflow checkout, protected main and release source are distinct authorities under ADR 0010.

## Protected-main evolution reconciled

Protected main currently includes:

- durable Today synchronization (#127);
- readiness/buyer-gap accounting and bounded OpenCode hardening;
- authentication-age/recent-auth data-rights prerequisites (#134/#136/#137);
- durable data-rights request/terminal receipt persistence (#138);
- tenant-and-requesting-actor scoped request status lookup (#144);
- signed trusted calendar workspace context (#139).

The old documentation PR #126 became materially diverged while these changes integrated and has been superseded by this clean current-main successor rather than merging obsolete implementation ancestry.

## Active implementation that documentation must not promote prematurely

### PR #146 — authenticated data-rights request status

**Status:** Implemented on active PR

The active slice adds a browser-facing authenticated status resource over the protected-main ledger. It derives workspace/requesting-user authority from session introspection, exposes only a bounded lifecycle projection, applies non-cacheable HTTP semantics and maps malformed/auth/absence/dependency states without disclosing cross-tenant existence or internal digest/idempotency material. Whole export/erasure completion remains issue #55.

### PR #147 — verification evidence identity

**Status:** Implemented on active PR

The active slice advances issue #132 by separating exact contributor source-head verification from synthetic merge-tree compatibility and adding the required runtime support for merge compatibility evidence. ADR 0010 records the timeless identity model. The implementation must not be described as protected-main behavior until integration.

## Current product gaps that must remain explicit

- **Partial:** complete tenant export/deletion orchestration — #55.
- **Partial:** per-user encrypted calendar credential lifecycle — #129.
- **Planned:** plugin installation/secrets/outbound delivery — #130.
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

The repository becomes protected-main documentation sufficient only after PR #145 passes exact-current-head CI/security/review/documentation contracts and merges against a freshly verified live base without regressing current source/policy.

## Continuation rule

Documentation integration is a governance gate, never product-completion. After documentation work the autonomous maintenance queue immediately returns to non-documentation execution: complete the bounded #146 status resource, integrate #147 when review/policy permit, and continue #55/#129/#130 plus subsequently discovered buyer/security/reliability/operability gaps.
