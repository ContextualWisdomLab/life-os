# LifeOS Requirements and Evidence Traceability

**Baseline:** protected `main` at `2ad45a935283e83d9bb0f3ea5c3d23b2669078b1`

## 1. Purpose

This file maps canonical requirements and architecture decisions to representative protected-main code/tests/runbooks/capability evidence and current active implementation PRs. It is an index, not an exhaustive substitute for source control, migrations, exact-head checks, or `product/capabilities.json`.

An entry marked `Implemented on active PR` is not protected-main evidence. PR identity is recorded separately from status so a closed, replaced, rebased, or merged PR cannot silently preserve stale maturity.

## 2. Product requirement traceability

| PRD requirement | Status | Capability / authority | Representative implementation | Representative verification / operations |
| --- | --- | --- | --- | --- |
| PRD-ID-001 Google/GitHub login | Implemented on protected main | `identity.oauth-session` | `apps/identity-service/src/` | `oauth-http.integration.test.ts` |
| PRD-ID-002 revocable scoped session | Implemented on protected main | identity service | identity runtime/session repositories | identity/security tests |
| PRD-ID-003 UUIDv4 internal IDs | Implemented on protected main | ADR-0002 / `AGENTS.md` | service migrations/domain validators | UUID constraint/validation tests |
| PRD-ID-004 tenant-derived authority | Implemented on protected main | identity + owning service | signed/authenticated context boundaries | cross-tenant integration tests |
| PRD-PLAN-001 durable goals/projects/tasks | Implemented on protected main | `planning.durable-data` | `apps/planning-service/src/postgres-planning-repository.ts` | `postgres-planning-repository.integration.test.ts` |
| PRD-PLAN-002 durable planning search | Implemented on protected main | `capture.search` | `apps/planning-service/src/search.ts` | planning/web search tests |
| PRD-PLAN-003 quick capture/local draft distinction | Implemented on protected main | `capture.search` / Today UX | `apps/web/app/components/quick-capture.tsx` | `quick-capture-search.spec.ts` |
| PRD-PLAN-004 Today action loop | Implemented on protected main | `today.action-loop` | web Today components/gateway composition | `apps/web/e2e/today-flow.spec.ts` |
| PRD-PLAN-005 full durable Today optimistic multi-device sync | Implemented on active PR | issue #121 / PR #127 | versioned Today aggregate, strong revision preconditions, idempotency, planning-owned PostgreSQL persistence and explicit local-to-durable UX on PR #127 | exact #127 head must pass planning/PostgreSQL/browser/conflict/offline acceptance before protected-main upgrade |
| PRD-HAB-001 recurring habit + history | Implemented on protected main | `habit.recurring-core` | `apps/habit-service/` | habit service/PostgreSQL integration tests |
| PRD-REV-001 guided review | Implemented on protected main | `review.guided-loop` | `apps/review-service/` | review service integration tests |
| PRD-CAL-001 calendar synchronization | Implemented on protected main | `calendar.time-blocking`; completed issue #51 | `apps/integration-calendar-service/` | calendar sync integration tests |
| PRD-CAL-003 hosted per-user Google token lifecycle | Partial | issue #129 | current adapter uses operator-supplied runtime token in documented slice | encrypted per-user storage/refresh/revocation/provider-selection gap is explicit |
| PRD-NOT-001 bounded reminders | Implemented on protected main | `notifications.reminders` | `apps/notification-service/src/reminder-scheduler.ts` | scheduler/integration tests; `docs/operations/notification-persistence.md` |
| PRD-NOT-002 durable claim/retry/idempotency | Implemented on protected main | notification persistence | `postgres-reminder-repository.ts` + runtime | PostgreSQL/concurrency integration tests |
| PRD-AI-001 inert proposals | Implemented on protected main | ADR-0004 / AI service | proposal service/audit domain | no-silent-mutation + proposal tests |
| PRD-AI-002 proposal evidence + explicit decisions | Implemented on protected main | AI audit capability | AI PostgreSQL proposal audit repository/application | proposal audit HTTP/PostgreSQL tests |
| PRD-AI-003 authenticated same-origin AI boundary | Implemented on protected main | AI gateway trust boundary | web AI proposal BFF/routes + signed context | scope/identity-stream/routes integration tests |
| PRD-AI-004 deterministic quality independent of live provider | Implemented on protected main | quality/live-conformance split | proposal quality evaluator + optional live model adapter | quality fixture tests + scheduled bounded live evidence |
| PRD-AI-005 bounded deeper orchestration | Accepted architecture | strong single-route baseline + explicit orchestration evidence | protected-main quality/conformance harness | PR #133 is active technical hardening for explicit model catalog and real Compose runtime proof, not a new product-data authority |
| PRD-AI-006 autonomous OpenCode development loop | Implemented on protected main | PR #122 merged as `876850018a17323900844e79845ba395b7bf6a9a` / issue #120 | `.github/workflows/opencode-commercial-development.yml`, `packages/commercial-development-agent/` | exact-head CI, AppGuardrail, Semgrep, Security Scan and CodeRabbit passed before guarded merge; PR #133 remains active follow-up hardening |
| PRD-PRIV-001 purpose-bound sensitive access | Implemented on protected main | ADR-0005 | `apps/privacy-service/` | privacy service PostgreSQL/security tests |
| PRD-PRIV-002 bounded grants + append-only evidence | Implemented on protected main | privacy access domain | privacy decision/grant/event persistence | exact expiry/concurrency/immutability tests |
| PRD-PRIV-004 end-user export/deletion UX | Partial | issue #55 / PR #134 | identity-owned data-rights core exists; PR #134 actively preserves real authentication age across session rotation for the recent-auth prerequisite | concrete domain adapters, durable orchestration/reconciliation, retention/legal-hold, protected delivery, download audit and remaining recent-auth integration are still required |
| PRD-INT-001 versioned plugin contract | Implemented on protected main | plugin integration | `packages/plugin-sdk/`, `apps/integration-service/` | plugin contract integration tests |
| PRD-INT-003 plugin installation/secrets/outbound delivery | Planned | issue #130 | validation/preparation surface exists; runtime authority is intentionally absent | installation grants, encrypted secrets, SSRF-safe delivery, retry/audit/revocation tests required |
| PRD-WEB-001 installable responsive PWA | Implemented on protected main | `mobile.pwa` | manifest/service worker/web app | `mobile-pwa.spec.ts` |
| PRD-WEB-002 accessibility | Implemented on protected main | `accessibility.localization` | semantic web components/design tokens | accessibility E2E/current core-flow tests |
| PRD-WEB-003 Korean/English localization | Implemented on protected main | `accessibility.localization` | `apps/web/messages/en.json`, `ko.json` | localization/catalog tests |
| PRD-WEB-004 Today offline/durable reconciliation | Implemented on active PR | issue #121 / PR #127 | explicit local draft migration and conflict/recheck flow for the bounded Today aggregate | broader offline behavior must not be inferred beyond PR #127 acceptance scope |
| PRD-GOV-001 capability maturity separated from buyer-gap exhaustion | Implemented on protected main | completed issue #128 / ADR-0008 / merged PR #131 | `product/buyer-gaps.json` and separate readiness dimensions on protected main `2ad45a935283e83d9bb0f3ea5c3d23b2669078b1` | malformed/duplicate/unknown/fetch-failure and open/resolved/unknown contract tests integrated with exact-PR-head audit binding |
| PRD-GOV-002 untrusted issue/review/model prose is non-executable governance input | Implemented on protected main | ADR-0008 / security boundary | canonical gap identity is repository-owned and live reconciliation consumes bounded issue state only | PR #131 exact-head gates passed before guarded squash merge; raw issue/review/model prose does not define policy |
| PRD-OPS-001 verified logical backup/restore | Implemented on protected main | backup/recovery capability | `infra/backup/` | restore/deployment tests + `backup-and-restore.md` |
| PRD-OPS-002 production reference deployment | Implemented on protected main | deployment capability | `infra/kubernetes/`, deployment workflow | infra tests + `production-deployment.md`; `reference` describes scope only |
| PRD-OPS-003 health/metrics operator surface | Implemented on protected main | observability capability | gateway/planning/service observability | SLO/runbook/observability tests |

## 3. Architecture decision traceability

| ADR | Current invariant/evidence | Regression expectation |
| --- | --- | --- |
| ADR-0001 multi-user/self-hostable MSA | README, service layout, Compose/Kubernetes, PostgreSQL | local browser state never masquerades as durable system of record |
| ADR-0002 UUIDv4 | AGENTS/CLAUDE/ARCHITECTURE, validators/migrations | reject non-v4 internal IDs where the domain requires the shared invariant |
| ADR-0003 service-owned persistence | root architecture, independent service repositories/migrations | no cross-service table access; contract/event integration only |
| ADR-0004 inert AI proposal | AI architecture, proposal persistence/decision domain | no planning mutation dependency; stale/replay/prompt-injection tests |
| ADR-0005 purpose-bound sensitive access | privacy-service | actor/resource/purpose/grant expiry/replay/audit tests |
| ADR-0006 work-conserving maintenance | AGENTS waiting/PR loop + protected-main OpenCode automation | exact-head evidence, blocker-local routing, no fabricated approval, no documentation-only stopping |
| ADR-0007 canonical documentation graph | PR #126 until merged | exact status vocabulary, real link targets, ADR stable-filename index targets, source-bound claims, active-PR/protected-main status review |
| ADR-0008 capability maturity vs buyer gaps | Implemented on protected main at `2ad45a935283e83d9bb0f3ea5c3d23b2669078b1` | 100% configured capability evidence can coexist with open/unknown buyer gaps; issue prose cannot redefine gap policy |

## 4. Current active implementation ledger

This ledger is intentionally separate from protected-main evidence and must be live-refetched before use.

| PR | Scope | Canonical interpretation |
| --- | --- | --- |
| #127 | durable Today synchronization / issue #121 | product requirement implementation is `Implemented on active PR` until exact reviewed head merges |
| #133 | explicit model catalog plus Compose runtime verification | technical hardening of the protected-main #122 development loop; no protected-main transfer before merge |
| #134 | authentication-age preservation / issue #55 | bounded identity prerequisite for recent-authenticated data-rights operations; the overall export/deletion requirement remains `Partial` |

PR #131 is no longer an active implementation item: it merged to protected main as `2ad45a935283e83d9bb0f3ea5c3d23b2669078b1`, and issue #128 is closed as completed.

## 5. Canonical evidence hierarchy

When sources disagree, use this order:

1. current protected-main source/migrations/tests and configured branch/ruleset behavior;
2. exact current active-PR source explicitly labeled as active-PR evidence;
3. accepted/implemented ADRs and root `ARCHITECTURE.md` for durable decisions, without upgrading active code to protected-main status;
4. canonical PRD/TRD/data model/UML/threat/test/operability docs;
5. repository-owned capability and buyer-gap registries plus `CHANGELOG.md` as governed evidence;
6. current feature specs/runbooks/research documents for bounded detail;
7. historical specs/plans/closed PRs/conversation as rationale, not current implementation truth.

A resolved review thread does not outrank later exact-source regression evidence.

## 6. Known gaps exposed by this baseline

The maintenance loop must refetch issues/PRs and protected main before selecting work. The live product queue demonstrates why configured capability maturity cannot stand in for complete customer journeys.

### Highest-impact known gaps and active paths

1. **Issue #121 — durable Today workspace synchronization / optimistic concurrency.** PR #127 is the active implementation path. The requirement is not protected-main evidence until its exact reviewed head is integrated.
2. **Issue #55 — complete tenant export and deletion orchestration.** The identity-owned core export/erasure coordinator is implemented. PR #134 advances authentication-age preservation for recent-auth enforcement, while complete domain participation, durable request/receipt/reconciliation, gateway enforcement, retention/legal-hold/backup-expiry, encrypted delivery and download-audit follow-ups remain incomplete.
3. **Issue #129 — hosted per-user calendar credential lifecycle.** Conflict-safe CalDAV and Google provider adapters exist; encrypted per-user credential persistence/refresh/revocation/discovery/selection remains incomplete. The original CalDAV issue #51 is closed as completed rather than being kept open to represent a different product gap.
4. **Issue #130 — plugin runtime last mile.** Versioned manifest/event validation exists; installation grants, encrypted secret lifecycle, SSRF-safe outbound delivery, bounded retry/audit and revocation are explicitly tracked rather than implied by the validation-only contract.
5. **PR #133 — autonomous development runtime hardening.** The protected-main #122 loop exists, while #133 actively verifies explicit NVIDIA model catalog resolution and real digest-pinned Compose runtime behavior without broadening model authority.
6. **Stable release evidence.** Active development remains under `Unreleased`; integrated release gates must pass together before version/tag/release claims.

### Resolved governance defect

**Issue #128 — readiness accounting defect** is closed as completed. Protected main now contains the repository-owned buyer-gap registry and separate capability/gap dimensions from merged PR #131. This resolves the false zero-gap accounting defect without closing the actual registered buyer gaps themselves.

### Documentation engineering status

**Implemented on active PR:** PR #126 supplies the canonical documentation graph and `packages/commercial-readiness/src/documentation-contract.test.mjs`. The contract now fails on non-canonical status values, missing stable ADR filename targets, missing active PR #127/#133/#134 or protected-main #131 traceability, repository-escaping/broken README links, and selected source/configuration evidence drift. This remains active-PR evidence until PR #126 itself merges.

## 7. Commercial-readiness interpretation

Configured capability maturity and canonical buyer-gap state are now separate protected-main dimensions under ADR-0008 and merged PR #131. A 100% configured maturity score is still not equivalent to a complete product: registered gaps #55, #121, #129 and #130 remain independently visible until their own product outcomes close.

If live state for a registered gap is unavailable or ambiguous, the buyer-gap dimension reports `unknown`, not silently resolved. Readiness consumers must combine capability maturity, canonical buyer-gap state, end-to-end PRD journey coverage, operator/release acceptance, and fresh source evidence.

## 8. Updating traceability

When a requirement changes status:

1. verify exact protected-main or active-PR evidence;
2. update PRD status using only the canonical vocabulary;
3. update this row/path/test/issue/PR evidence;
4. update architecture/ADR if authority, ownership or readiness interpretation changed;
5. update data/UML/threat/operability docs if their boundary changed;
6. add/modify regression evidence;
7. update `CHANGELOG.md` for buyer-visible behavior;
8. do not upgrade to `Implemented on protected main` before merge;
9. if an active PR closes/replaces/rebases, immediately revalidate or downgrade its documentation status rather than preserving stale evidence.
