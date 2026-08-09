# LifeOS Requirements and Evidence Traceability

**Baseline:** protected `main` at `5c87a7ec3568a4ce47b25cad843f1bc5be91b294`

## 1. Purpose

This file maps canonical requirements and architecture decisions to representative protected-main code/tests/runbooks/capability evidence. It is an index, not an exhaustive substitute for source control or `product/capabilities.json`.

An entry marked `Implemented on active PR` is not protected-main evidence.

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
| PRD-PLAN-005 full durable Today optimistic multi-device sync | Partial | tracked buyer gap | durable planning exists; full aggregate contract not yet canonical protected-main evidence | require conflict/offline/multi-device integration evidence before upgrading |
| PRD-HAB-001 recurring habit + history | Implemented on protected main | `habit.recurring-core` | `apps/habit-service/` | habit service/PostgreSQL integration tests |
| PRD-REV-001 guided review | Implemented on protected main | `review.guided-loop` | `apps/review-service/` | review service integration tests |
| PRD-CAL-001 calendar synchronization | Implemented on protected main | `calendar.time-blocking` | `apps/integration-calendar-service/` | calendar sync integration tests |
| PRD-CAL-003 hosted per-user Google token lifecycle | Partial | calendar integration boundary | current adapter uses operator-supplied runtime token in documented slice | README explicitly defers per-user storage/refresh/revocation |
| PRD-NOT-001 bounded reminders | Implemented on protected main | `notifications.reminders` | `apps/notification-service/src/reminder-scheduler.ts` | scheduler/integration tests; `docs/operations/notification-persistence.md` |
| PRD-NOT-002 durable claim/retry/idempotency | Implemented on protected main | notification persistence | `postgres-reminder-repository.ts` + runtime | PostgreSQL/concurrency integration tests |
| PRD-AI-001 inert proposals | Implemented on protected main | ADR-0004 / AI service | proposal service/audit domain | no-silent-mutation + proposal tests |
| PRD-AI-002 proposal evidence + explicit decisions | Implemented on protected main | AI audit capability | AI PostgreSQL proposal audit repository/application | proposal audit HTTP/PostgreSQL tests |
| PRD-AI-003 authenticated same-origin AI boundary | Implemented on protected main | AI gateway trust boundary | web AI proposal BFF/routes + signed context | scope/identity-stream/routes integration tests |
| PRD-AI-004 deterministic quality independent of live provider | Implemented on protected main | quality/live-conformance split | proposal quality evaluator + optional live model adapter | quality fixture tests + scheduled bounded live evidence |
| PRD-AI-006 autonomous OpenCode development loop | Implemented on active PR | PR #122 / issue #120 | `feat/opencode-commercial-development-loop` | not protected-main evidence until merge |
| PRD-PRIV-001 purpose-bound sensitive access | Implemented on protected main | ADR-0005 | `apps/privacy-service/` | privacy service PostgreSQL/security tests |
| PRD-PRIV-002 bounded grants + append-only evidence | Implemented on protected main | privacy access domain | privacy decision/grant/event persistence | exact expiry/concurrency/immutability tests |
| PRD-PRIV-004 end-user export/deletion UX | Partial | data-rights architecture/legal docs | identity/privacy/legal pieces exist | retain Partial until end-to-end UX/job/retry/audit evidence is mapped |
| PRD-INT-001 versioned plugin contract | Implemented on protected main | plugin integration | `packages/plugin-sdk/`, `apps/integration-service/` | plugin contract integration tests |
| PRD-INT-003 plugin install/secrets/outbound delivery | Planned | explicitly deferred | no shipped generic authority claim | requires separate auth/SSRF/audit design and tests |
| PRD-WEB-001 installable responsive PWA | Implemented on protected main | `mobile.pwa` | manifest/service worker/web app | `mobile-pwa.spec.ts` |
| PRD-WEB-002 accessibility | Implemented on protected main for current core flows | `accessibility.localization` | semantic web components/design tokens | accessibility E2E/current tests |
| PRD-WEB-003 Korean/English localization | Implemented on protected main | `accessibility.localization` | `apps/web/messages/en.json`, `ko.json` | localization/catalog tests |
| PRD-WEB-004 complete offline conflict recovery | Partial | PWA/Today gap | local draft state exists | require explicit durable reconnect/conflict journey before upgrading |
| PRD-OPS-001 verified logical backup/restore | Implemented on protected main | backup/recovery capability | `infra/backup/` | restore/deployment tests + `backup-and-restore.md` |
| PRD-OPS-002 production reference deployment | Implemented on protected main as reference | deployment capability | `infra/kubernetes/`, deployment workflow | infra tests + `production-deployment.md` |
| PRD-OPS-003 health/metrics operator surface | Implemented on protected main | observability capability | gateway/planning/service observability | SLO/runbook/observability tests |

## 3. Architecture decision traceability

| ADR | Protected-main invariant/evidence | Regression expectation |
| --- | --- | --- |
| ADR-0001 multi-user/self-hostable MSA | README, service layout, Compose/Kubernetes, PostgreSQL | local browser state never masquerades as durable system of record |
| ADR-0002 UUIDv4 | AGENTS/CLAUDE/ARCHITECTURE, validators/migrations | reject non-v4 internal IDs where the domain requires the shared invariant |
| ADR-0003 service-owned persistence | root architecture, independent service repositories/migrations | no cross-service table access; contract/event integration only |
| ADR-0004 inert AI proposal | AI architecture, proposal persistence/decision domain | no planning mutation dependency; stale/replay/prompt-injection tests |
| ADR-0005 purpose-bound sensitive access | privacy-service | actor/resource/purpose/grant expiry/replay/audit tests |
| ADR-0006 work-conserving maintenance | AGENTS waiting/PR loop + commercial-readiness automation | exact-head evidence, blocker-local routing, no fabricated approval |
| ADR-0007 canonical documentation graph | this documentation baseline | documentation consistency tests and protected-main status review |

## 4. Canonical evidence hierarchy

When sources disagree, use this order:

1. current protected-main source/migrations/tests and configured branch/ruleset behavior;
2. accepted ADRs and root `ARCHITECTURE.md`;
3. canonical PRD/TRD/data model/UML/threat/test/operability docs;
4. `product/capabilities.json` and `CHANGELOG.md` as maturity/change evidence;
5. current feature specs/runbooks/research documents for bounded detail;
6. active PR evidence explicitly labeled as active PR;
7. historical specs/plans/closed PRs/conversation as rationale, not current implementation truth.

## 5. Known gaps exposed by this baseline

These are not automatically the only open product gaps; the maintenance loop must refetch issues/PRs and current main before selecting work.

### Highest-impact known gaps

1. **Durable Today workspace synchronization / optimistic concurrency** — durable planning exists, but complete multi-device/local-draft migration/conflict flow is not proven as one current protected-main vertical slice.
2. **Hosted per-user Google Calendar credential lifecycle** — provider adapter exists; durable encrypted token storage/refresh/revocation/discovery remains explicitly deferred in current README.
3. **End-to-end user data-rights UX** — privacy access controls and legal docs are strong, but export/deletion customer journey needs one canonical end-to-end evidence map before `Implemented` status.
4. **Plugin runtime last mile** — versioned contract exists; install/secret/outbound delivery/inbound commands need explicit least-authority, SSRF and audit design before productization.
5. **Offline/PWA durable reconciliation** — installable PWA/local draft distinction exists; complete reconnect/conflict recovery is not yet a protected-main product claim.
6. **Stable release evidence** — active development remains under `Unreleased`; integrated release gates must pass together before version/tag/release claims.

### Documentation engineering gap

Add a deterministic documentation contract that validates canonical file/index presence, ADR status/index consistency, Markdown/Mermaid integrity, current UUIDv4/service-ownership claims, and representative traceability paths against the repository.

## 6. Updating traceability

When a requirement changes status:

1. verify exact protected-main or active-PR evidence;
2. update PRD status;
3. update this row/path/test evidence;
4. update architecture/ADR if authority or ownership changed;
5. update data/UML/threat/operability docs if their boundary changed;
6. add/modify regression evidence;
7. update `CHANGELOG.md` for buyer-visible behavior;
8. do not upgrade to `Implemented on protected main` before merge.
