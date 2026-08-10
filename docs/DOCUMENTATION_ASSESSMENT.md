# LifeOS Documentation Fitness Assessment

**Status:** Implemented on active PR

## Verdict

Historical LifeOS material was extensive but not sufficient as one code-current whole-product authority. The project moved through materially different product models: browser-only/login-free local-first, public multi-user server persistence, a single-Docker direction, and finally domain-oriented modular MSA. Protected-main implementation also continued after the first canonical docs branch diverged.

PR #145 remains the single canonical successor. Its family coverage is **design-sufficient in scope** when its exact-head semantic documentation contracts are green: PRD, TRD, root Architecture, ADR 0001-0012, logical ERD/Data Model, UML, API/event contracts, Security, Threat Model, Privacy/Data Lifecycle, Test Strategy, Operability, Release/Migration/Rollback, Standards/Research and Requirements Traceability exist with machine-checkable consistency rules. Repository-wide test-time-compute/model-assisted-development authority is represented by ADR 0012, canonical Fugu/Conductor/TRINITY/strong-single-agent/NVIDIA research traceability, and a UML authority flow that keeps model execution separate from deterministic review/merge/release authority.

The repository remains **protected-main documentation insufficient** until this canonical successor is reconciled to current protected main, passes exact-head CI/security/review/documentation contracts, and integrates. Documentation sufficiency is never product or release completion.

## Fitness matrix

| Family | Assessment on #145 | Maturity | Notes |
| --- | --- | --- | --- |
| PRD | Present-stale | Implemented on active PR | family coverage is complete, but protected #168/#169/#170/#172/#173 and active #165/#175/#176 require semantic reconciliation |
| TRD | Present-stale | Implemented on active PR | runtime, authority, data, API/event, concurrency, AI/security/ops/release and evidence-identity contracts exist; latest protected integration state must be folded in |
| Root Architecture | Present-stale | Implemented on active PR | bounded-context and authority spine exists, but latest Planning/Habit/plugin-credential protected behavior is newer than the current canonical snapshot |
| ADR index / decisions | Present-current | Implemented on active PR | ADR 0001-0012 cover identifiers, persistence, AI, privacy, maintenance, documentation, maturity, hosting, evidence identity, integration authority and test-time compute/model-development authority |
| Logical ERD / Data Model | Present-stale | Implemented on active PR | protected plugin installation persistence and credential-reference metadata now supersede the earlier active-PR-only representation; active #175/#176 remain non-shipped evidence |
| UML | Present-stale | Implemented on active PR | topology, login, Today/review, calendar, AI, model-governance, rights, plugin, verification, deployment and degraded modes exist; latest signed-authority rollouts require reconciliation |
| API/event contracts | Present-stale | Implemented on active PR | latest Planning/Habit signed workspace authority and plugin credential-reference boundaries are protected-main behavior; Review and evidence-identity hardening remain active PRs |
| Security | Present-current | Implemented on protected main | root `SECURITY.md` remains vulnerability-reporting authority; service-specific trust boundaries are tracked in architecture/research/test evidence |
| Threat model | Present-stale | Implemented on active PR | trust-boundary coverage exists but current protected signed-workspace and plugin-secret-reference evolution must be reflected |
| Privacy/Data Lifecycle | Present-stale | Implemented on active PR | purpose-bound rights and secret-reference boundaries exist; current plugin credential-reference protection and incomplete hosted runtimes must be reconciled |
| Test Strategy | Present-current | Implemented on active PR | realistic PostgreSQL/browser/security/concurrency/evidence policy remains current as a repository-wide contract |
| Operability | Present-current | Implemented on active PR | deployment/readiness/observability/failure/backup/recovery boundaries remain current at repository level |
| Release/Migration/Rollback | Present-current | Implemented on active PR | one exact integrated release-source contract and fail-closed migration/rollback discipline remain current |
| Standards/Research | Present-current | Implemented on active PR | final-vs-draft discipline, APA 7 anchors and repository-wide model-orchestration evidence/counterevidence are present |
| Requirements Traceability | Present-stale | Implemented on active PR | requirement/decision-to-source/test/issue/PR mapping exists but must absorb protected #168/#169/#170/#172/#173 and active #165/#175/#176 |
| AGENTS authority | Present-current | Implemented on protected main | protected main carries work-conserving maintenance, NVIDIA/no-Copilot, exact-evidence, service ownership and review/merge authority rules |
| CHANGELOG behavior history | Present-current | Implemented on protected main | protected feature/security changes continue to update the Unreleased history independently of canonical docs integration |
| README/CLAUDE canonical discoverability | Present-current on successor | Implemented on active PR | discoverability becomes protected-main authority only after #145 integration |
| Machine-checkable documentation consistency | Present-current | Implemented on active PR | required files/links, maturity vocabulary, ADR 0001-0012, evidence identity, model authority and stale-product semantics are gated |

## Historical drift reconciled

1. **Private/login-free local-first -> public multi-user server-backed/self-hostable.** Browser-local state is explicit draft/cache/offline state.
2. **Single Docker application -> modular MSA.** Compose remains a profile, not authority collapse.
3. **UUIDv7 -> UUIDv4.** Internal product IDs are opaque UUIDv4.
4. **Old post-MVP labels -> evidence maturity.** Protected source/tests outrank roadmap prose.
5. **Capability maturity -> buyer-gap exhaustion.** These are independent evidence dimensions.
6. **Generic green status -> explicit evidence identity.** ADR 0010 separates source head, PR-base snapshot, live base, integration/synthetic tree, workflow checkout, protected main and release source.
7. **External integration metadata -> ambient authority.** ADR 0011 separates LifeOS identity, provider/plugin metadata, secret references and explicit capability grants.
8. **More agents -> assumed better output.** ADR 0012 requires a strong single-route baseline and measured stage/decomposition/recursion/role-effort/access-topology evidence under documented budgets before deeper orchestration is selected.
9. **Development model -> repository authority.** ADR 0012 and protected `AGENTS.md` keep NVIDIA/OpenCode model execution independent from deterministic CI/security, formal review, merge and release authority.

## Protected-main evolution represented or requiring current reconciliation

Protected main includes durable Today (#127), trusted calendar workspace context (#139), recent-auth/data-rights prerequisites (#134/#136/#137), durable rights ledger (#138), tenant+actor status lookup (#144), authenticated public rights status (#146), export integrity evidence (#149), workspace+user calendar connection persistence (#150), explicit plugin installation grants (#151), migration-fixture reliability repair (#152), atomic calendar connection revocation (#153), exact-source/current-live-base/integration verification hardening (#154), signed calendar workspace+user authority (#155), signed Planning workspace authority (#168), durable plugin installation persistence (#169), isolated data-rights ledger test ownership (#170), opaque plugin credential-reference persistence (#172), and signed Habit workspace authority (#173).

The old documentation PR #126, old verification PR #147, and superseded implementation lines such as #156 are historical evidence only. Their reviews/checks never substitute for current protected-main or current-head evidence.

## Current active work represented without promotion

- **PR #165 — Review signed workspace authority:** `Implemented on active PR`. Review completion/history routes move from browser-selectable workspace authority to signed gateway context. It is not protected-main truth until integrated.
- **PR #175 — plugin installation evidence identity:** `Implemented on active PR`. Application-level install/replay and lookup must reject durable evidence for a different opaque installation identifier.
- **PR #176 — calendar connection lookup evidence identity:** `Implemented on active PR`. Calendar persistence must reject returned durable rows whose connection/workspace/user identity differs from exact lookup authority.

These active PRs are verification/security hardening, not evidence that the parent hosted-runtime gaps are complete.

## Verification-governance residual

PR #154 is **Implemented on protected main**. LifeOS-owned source verification, AppGuardrail attribution and current-live-base integration compatibility are separated by explicit evidence identity. Issue #132 remains open only for residual central reusable scanner taxonomy: central SAST/Security jobs must expose the actual tree they inspected so synthetic/integration evidence is not promoted to exact-source evidence.

## Remaining product gaps

- **Partial:** #55 complete export/deletion orchestration, despite protected public status/export-integrity and ledger foundations.
- **Partial:** #129 complete hosted per-user calendar credential lifecycle, despite protected calendar connection/revocation/signed user authority and active #176 evidence hardening.
- **Partial:** #130 complete plugin runtime delivery, despite protected grant authority, durable installation persistence, opaque credential-reference persistence and active #175 evidence hardening. Secret materialization/KMS implementation, outbound SSRF-safe delivery, retry/dead-letter/runtime composition and operator surfaces remain separate work.
- **Residual governance gap:** #132 central scanner checkout/attribution taxonomy after protected #154.

## Sufficiency criteria

The documentation line is design-sufficient only when canonical families are discoverable, statuses use exact vocabulary, ADR targets/sections are valid, diagrams are balanced, root Architecture matches protected service authority, active behavior is not called shipped, requirements/gaps map to executable evidence, model-development authority and its counterevidence are canonical, and semantic-regression tests fail when currentness drifts.

The repository is protected-main documentation sufficient only after PR #145 is reconciled to a freshly resolved live base, passes current exact-head CI/security/review/documentation contracts, and integrates without regressing current source/policy.

## Continuation rule

Documentation completion is a governance gate only. While #145 is stale, conflicted, checking, or awaiting integration, the autonomous queue continues current security/reliability PRs and the remaining #55/#129/#130/#132 work plus newly discovered buyer/security/reliability/operability gaps. A green documentation pack is not a product-completion or run-termination condition.
