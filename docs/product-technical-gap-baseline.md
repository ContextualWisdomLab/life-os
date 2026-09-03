# LifeOS product and technical gap baseline

**Baseline date:** 2026-09-03 (KST)  
**Protected-main evidence commit:** `17c990fd9b096131468e3227be8913d06d2c11aa`  
**Status:** code-current evidence baseline carried by active documentation PR #211 until protected integration  
**Primary commercial tracking:** #21, with canonical P0 buyer gaps #55, #129, #130, #209, and #210

This document distinguishes shipped truth from active-PR evidence. A file, route, test, workflow, or mergeable PR is not a shipped capability until the exact unchanged head integrates through the live protected-branch policy. Historical checks and approvals do not transfer after a head movement.

## Current decision

LifeOS has a substantial server-backed modular MSA foundation, but it is not yet a complete commercial product or a release-ready artifact.

Protected main owns the current domain truth and service boundaries. Planning, Habit, Review, Identity, Calendar, Integration/Plugin, Notification, and AI remain separate bounded contexts with service-owned persistence, migrations, credentials, and runtime authority. Cross-service SQL and browser-selected tenant authority are not acceptable shortcuts. Durable browser state becomes domain truth only after exact server/persistence evidence is validated. Sensitive reads and mutations remain purpose-bound.

The highest-value remaining work is not to create another parallel foundation. It is to finish the existing dependency-ordered buyer journeys, data-rights participants, Calendar and Plugin authority stacks, then prove the integrated product from immutable release artifacts.

## Evidence hierarchy

Use the following order when claims conflict:

1. protected `main` at the exact commit named above;
2. live AGENTS/CLAUDE/PRD/TRD/ARCHITECTURE/ADR and executable code/contracts on that protected tree;
3. exact-head active PR evidence, explicitly labeled unshipped;
4. issues, plans, historical PR bodies, and research references.

`mergeable: true`, queued checks, absent checks on a non-default stacked PR, predecessor approvals, or a documentation statement are never passing release evidence.

## Canonical architecture constraints

- LifeOS remains a server-backed modular MSA. Each service owns its persistence, schema migrations, credentials/secrets boundary, repositories, domain events, and recovery behavior.
- Authentication derives workspace/user authority server-side. Keyverse may become the canonical identity backend only through a released versioned contract/ACL; mutable upstream heads or copied source are not authority.
- Durable acceptance is explicit. Optimistic, duplicated, unsolicited, stale-scope, impossible, or conflicting browser evidence cannot silently become persisted truth.
- Planning owns Goals/Projects/Tasks/Today; Habit owns habit definitions/occurrences/history; Review consumes projections rather than becoming a second Planning/Habit store.
- Calendar and Plugin provider/destination data are intent until an explicit scoped host/user authority record exists. Secret material is materialized only behind the owning secret/KMS port and must not enter database rows, logs, public errors, model prompts, or CI artifacts.
- AI proposals remain distinguishable from user-authored state and require explicit durable acceptance. Model calls consume a released contextual-orchestrator API/client/schema and the virtual `orchestrator/free` route; provider/model/group/paid fallback selection and provider credential discovery remain contextual-orchestrator authority.
- Optional CWL foundations are consumed through released/versioned contracts and ACLs. LifeOS does not copy their source or query their persistence directly.

## P0 buyer gaps

### #209 — complete authenticated Goal → Project → Task → Habit → Today → Review workspace

Protected main still does not ship the complete defining first-party journey. The active dependency-ordered Draft stack now contains substantial BFF and workspace slices; those branches are progress evidence only.

Current root of the stack is #214, based directly on `main@17c990fd9b096131468e3227be8913d06d2c11aa`. The current product stack is #214 → #237 → #238 → #225 → #226 → #229 → #231 → #232 → #233 → #234. Descendants must stay non-force and preserve parent authority. Their absence of PR-triggered checks while targeting non-default parents is not GREEN evidence.

Still required before #209 can close:

- durable onboarding conversion into a Goal with explicit local-draft attachment consent;
- stable authenticated navigation for Today, Goals, Projects, Tasks, Habits, Review, and Settings;
- authoritative read-only Planning/Habit projections in Weekly Review rather than user-entered aggregates standing in for them;
- Settings surfaces for timezone/locale, identity/session state, notification preferences, Calendar/Plugin connection state, data-rights status, and account lifecycle without becoming a persistence owner;
- Figma/Product Design/Storybook traceability, reusable components/tokens, normal/loading/empty/error/access-denied/offline/conflict states, responsive interaction and current-head accessibility evidence;
- KO/EN/JA/ZH/VI/ES/DE/FR resource/screen-key parity, CJK fallback/text expansion evidence, and a DB-versioned translation ledger kept separate from ontology labels;
- exact release-artifact E2E for new user, returning user, second device, conflict recovery, mobile/offline, and accessibility journeys.

For applicable buyer-path API/web boundaries, measure current-head async E2E/k6 p95 against the repository target of 20 ms without sample exclusion or unrealistic warm-cache assumptions. Profile query/I/O/render/runtime/framework costs before any stack replacement.

### #55 — complete tenant export and deletion orchestration

Protected main already has Identity-owned orchestration and the versioned `life-os.data-rights-contributor.v1` boundary plus protected contributors such as Review. Active #198 and #199 add Notification- and AI-owned contributors and remain unshipped until exact-head policy gates pass.

Remaining outcome is cross-domain completeness: every persistence owner participates; participant inventory cannot silently omit a service; export is bounded/deterministic; erase is preflighted, replay-safe, and verified by each owner; legal hold/retention and backup-expiry outcomes are explicit; artifact delivery is encrypted/authenticated/expiring; partial failure has durable recovery; final success is issued only after the exact required participant set reconciles.

### #129 — complete per-user Calendar credential lifecycle

Protected main provides Calendar-owned connection persistence, scoped signed user authority, encrypted self-hostable secret storage, credential materialization, disconnect/read foundations, and provider adapters. Hosted production must not use deployment-wide provider credentials as request authority.

Active #216 removes deployment-wide Google/CalDAV credential authority from hosted composition while preserving explicit standalone composition. Stacked #228 adds purpose-bound Google OAuth state + PKCE authority. These are active-PR evidence only.

Remaining dependency order is a concrete PostgreSQL OAuth-state adapter/migration, bounded token exchange and refresh with single-flight fencing, post-exchange verifier cleanup, authenticated hosted provider composition from exact active connection evidence, revocation/KMS cleanup recovery, provider calendar discovery/selection, restart/key-rotation evidence, and end-to-end user-scoped synchronization.

### #130 — complete Plugin installation, secrets, and outbound delivery

Protected main owns versioned plugin SDK/manifest preparation, host-authorized installation/grant/revocation, PostgreSQL installation evidence, credential binding, and opaque secret-reference boundaries. A manifest cannot self-authorize capability or destination authority.

Active #205 adds host-owned HTTPS delivery-origin authority; stacked #235 adds the Integration-owned PostgreSQL grant store. They intentionally perform no outbound HTTP yet and remain unshipped.

Remaining outcome is concrete encrypted secret/KMS composition followed by SSRF/DNS-rebinding-safe outbound HTTPS, connect-time address enforcement or an equivalently reviewed egress boundary, redirect/proxy denial, finite request/response limits and deadlines, signed/idempotent deliveries, durable attempt/outcome/retry/dead-letter evidence, revocation fencing, operator recovery, and buyer-visible installation/delivery status.

### #210 — reproducible release candidate

Source and CI are not a release. The current release stack (#217 with stacked #236) advances machine-readable release evidence and detached signature verification, but remains active PR evidence.

A release-ready exact protected head must produce and verify version/CHANGELOG/tag/package identity, digest-pinned OCI/migration artifacts, SPDX 3.0.1 SBOM, SLSA provenance with the exact attained level, checksums/signatures, vulnerability evidence, reproducible install/upgrade/rollback, encrypted backup/restore with measured recovery evidence, and exact buyer journeys executed from immutable release artifacts. Do not claim stable/GA while another canonical P0 buyer gap remains open.

## Commercial-readiness and control-plane gaps

PR #230 hardens the read-only Actions workflow-registry evidence used by Commercial Readiness. Its current lineage fails closed on registry/tree/default-branch ambiguity but does not itself disable orphan workflow identities. Issue #202 remains the authorized control-plane owner for exact-state orphan disablement.

LifeOS-owned Actions lanes remain subject to the organization ruleset and central reusable workflows. Queueing, startup/control-plane failure, and central dependency-review support defects belong to their actual owner path; do not weaken LifeOS gates to manufacture GREEN evidence. #218 remains the LifeOS-owned explicit hosted-runner selection repair.

## Documentation and traceability

Canonical PRD/TRD/Architecture/ADR/UML/security/privacy/test/operations/release documentation remains owned by its accepted documentation line, including #145 where applicable. This baseline is a product/technical gap index, not a competing architecture source.

Standards and research references used for decisions belong in `docs/doctoring/REFERENCES.md` and canonical TRACEABILITY with APA 7th formatting. At minimum maintain current traceability for ISO/IEC 25010:2023, ISO/IEC 40500:2025 / WCAG 2.2, NIST SP 800-63-4, OWASP ASVS 5.0.0, SPDX 3.0.1, SLSA 1.2, and the cited goal-setting, implementation-intention, and habit-formation research. Do not turn standards mappings into certification claims.

GitHub Pages/public documentation is not considered published until the protected source integrates, the authorized repository settings path enables it, deployment succeeds, and the live HTTPS surface is verified.

## Release/merge gate

A root PR may move from Draft/Ready to normal merge only on an unchanged exact head with live-base compatibility, terminal applicable repository and central workflows, resolved actionable review threads, and the live independent approval requirement. No self-approval, stale predecessor evidence, force-push, destructive rebase, or routine administrator bypass.

A stacked child stays Draft until its prerequisite integrates, then adopts the resulting protected ancestry non-destructively and reacquires exact-head checks/reviews. A PR is closed only when the valid delta is absent, malicious, explicitly abandoned by the user, or completely transferred to a verified successor with tests/fixtures/contracts/evidence preserved.

## Buyer-visible completion test

LifeOS is commercially complete only when an operator can install immutable release artifacts and a user can authenticate, obtain a durable personal workspace, create and connect Goal/Project/Task/Habit state, execute Today, complete Weekly Review, manage Settings/integrations/data rights, recover from expected failures, and reproduce that evidence without repository-internal knowledge. Until then, the relevant P0 issue remains open even if its component services and tests exist.

Refs #21, #55, #129, #130, #145, #198, #199, #202, #205, #209, #210, #214, #216, #217, #218, #228, #230, #235, #236, #237, #238.