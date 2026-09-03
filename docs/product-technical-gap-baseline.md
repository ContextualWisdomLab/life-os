# LifeOS product and technical gap baseline

**Baseline date:** 2026-09-04 (KST)  
**Protected-main evidence commit:** `b84751674dd92bdcd0e266c7f002cdc43f5a938b`  
**Status:** code-current evidence baseline carried by active documentation PR #211 until protected integration  
**Primary commercial tracking:** #21, with canonical P0 buyer gaps #55, #129, #130, #209, and #210

This document distinguishes shipped truth from active-PR evidence. A file, route, test, workflow, or mergeable PR is not a shipped capability until the exact unchanged head integrates through the live protected-branch policy. Historical checks and approvals do not transfer after a head movement.

## Current decision

LifeOS has a substantial server-backed modular MSA foundation, but it is not yet a complete commercial product or a release-ready artifact.

Protected main owns current domain truth and service boundaries. Planning, Habit, Review, Identity, Calendar, Integration/Plugin, Notification, and AI remain separate bounded contexts with service-owned persistence, migrations, credentials, runtime authority, and recovery evidence. Cross-service SQL and browser-selected tenant authority are not acceptable shortcuts. Durable browser state becomes domain truth only after exact server/persistence evidence is validated. Sensitive reads and mutations remain purpose-bound.

The latest protected delta, #240, reverts unsafe docs-only skipping in LifeOS CI and Commercial Readiness because documentation can break executable content-assertion tests and commercial evidence. AppGuardrail's remaining docs filter and every central required workflow remain separate live policy concerns. This workflow correction changes no LifeOS domain truth.

The highest-value remaining work is to finish the existing dependency-ordered buyer journeys, data-rights participants, Calendar and Plugin authority stacks, then prove the integrated product from immutable release artifacts rather than create competing foundations.

## Evidence hierarchy

When claims conflict, use: (1) protected `main` at the exact commit above; (2) live AGENTS/CLAUDE/PRD/TRD/ARCHITECTURE/ADR and executable code/contracts on that tree; (3) exact-head active PR evidence explicitly labeled unshipped; (4) issues, plans, historical PR bodies, and research references.

`mergeable: true`, queued checks, absent checks on a non-default stacked PR, predecessor approvals, or a documentation statement are never passing release evidence.

## Canonical architecture constraints

- LifeOS remains a server-backed modular MSA. Each service owns persistence, schema migrations, credentials/secrets boundary, repositories, domain events, and recovery behavior.
- Authentication derives workspace/user authority server-side. Keyverse may be consumed only through a released versioned contract/ACL; mutable upstream heads or copied source are not authority.
- Durable acceptance is explicit. Optimistic, duplicated, unsolicited, stale-scope, impossible, conflicting, or malformed non-absence evidence cannot silently become persisted truth or ordinary not-found.
- Planning owns Goals/Projects/Tasks/Today; Habit owns definitions/occurrences/history; Review consumes authoritative projections rather than becoming a second Planning/Habit store.
- Calendar and Plugin provider/destination data are intent until explicit scoped host/user authority exists. Secret material is materialized only behind the owning secret/KMS port and must not enter database rows, logs, public errors, model prompts, or CI artifacts.
- AI proposals remain distinguishable from user-authored state and require explicit durable acceptance. Model calls consume a released contextual-orchestrator API/client/schema and `orchestrator/free`; provider/model/group/paid fallback selection and provider credential discovery remain contextual-orchestrator authority.
- Optional CWL foundations are consumed through released/versioned contracts and ACLs. LifeOS does not copy their source or query their persistence directly.

## P0 buyer gaps

### #209 — authenticated Goal → Project → Task → Habit → Today → Review workspace

Protected main still does not ship the complete defining first-party journey. The active dependency-ordered Draft stack contains substantial BFF and workspace slices and remains progress evidence only: #214 → #237 → #238 → #225 → #226 → #229 → #231 → #232 → #233 → #234. When protected main moves, each affected root/descendant must non-force adopt the new ancestry before promotion; absence of PR-triggered checks on non-default stacked children is not GREEN.

Still required: durable onboarding-to-Goal conversion with explicit local-draft attachment consent; stable authenticated navigation for Today/Goals/Projects/Tasks/Habits/Review/Settings; authoritative Planning/Habit projections in Weekly Review; Settings for locale/timezone/session/notifications/integrations/data rights/account lifecycle without becoming a persistence owner; Figma/Product Design/Storybook traceability and normal/loading/empty/error/access-denied/offline/conflict states; KO/EN/JA/ZH/VI/ES/DE/FR screen-key parity with CJK/text-expansion evidence and a DB-versioned translation ledger separate from ontology labels; release-artifact new/returning/second-device/conflict/mobile/offline/accessibility E2E.

For applicable buyer-path API/web boundaries, measure async current-head E2E/k6 p95 against the repository target of 20 ms without sample exclusion or unrealistic warm-cache assumptions; profile query/I/O/render/runtime/framework costs before stack replacement.

### #55 — tenant export and deletion orchestration

Protected main already has Identity-owned orchestration and the versioned `life-os.data-rights-contributor.v1` boundary plus protected contributor foundations. Active #198 and #199 add Notification- and AI-owned contributors and remain unshipped until exact-head policy gates pass.

Completion requires every persistence owner in an explicit participant inventory, bounded deterministic export, preflight/replay-safe owner-verified erase, legal-hold/retention and backup-expiry outcomes, encrypted authenticated expiring artifact delivery, durable partial-failure recovery, and a final whole-right success only after the exact required participant set reconciles.

### #129 — per-user Calendar credential lifecycle

Protected main provides Calendar-owned connection persistence, scoped signed user authority, encrypted self-hostable secret storage, credential materialization, disconnect/read foundations, and provider adapters. Hosted production must not use deployment-wide provider credentials as request authority.

Active #216 removes deployment-wide Google/CalDAV credential authority from hosted composition while preserving explicit standalone composition; stacked #228 adds purpose-bound Google OAuth state + PKCE authority. Remaining work is a concrete PostgreSQL OAuth-state adapter/migration, bounded token exchange/refresh with single-flight fencing, verifier cleanup, authenticated hosted provider composition from exact active connection evidence, revocation/KMS cleanup recovery, provider calendar discovery/selection, restart/key-rotation evidence, and end-to-end user-scoped synchronization.

### #130 — Plugin installation, secrets, and outbound delivery

Protected main owns versioned plugin SDK/manifest preparation, host-authorized installation/grant/revocation, PostgreSQL installation evidence, credential binding, and opaque secret-reference boundaries. A manifest cannot self-authorize capability or destination authority.

Active #205 exact head `664d7fb14827389e2b969392c89f7858a5acc146` adds host-owned HTTPS delivery-origin authority. Its durable-evidence lineage bounds timestamps across installation, grant creation/replay, current reads, and revocation: grants cannot predate installation or be promoted from the future; current reads reject future lifecycle evidence; future-shifted revoke winners fail closed while older durable revocations remain replay-safe. Active grant reads also re-resolve exact installation/workspace/user authority, so installation revocation cannot leave reusable active origin authority; grant evidence predating the current owning installation fails closed. RED `9cba31e1df49393f93fd070ed266f4c867af093e` / GREEN `664d7fb14827389e2b969392c89f7858a5acc146` additionally makes exact `undefined` the only normal read-port absence sentinel: malformed non-undefined durable evidence is validated and fails closed rather than being collapsed into not-found, while a structurally valid cross-scope record remains tenant-indistinguishable absence. These checks introduce no network delivery.

Stacked #235 exact head `636551a4998fe8f6f2293be86128acbf89db8a0a` is a non-force two-parent descendant of current #205 and remains exactly a seven-path Integration-owned PostgreSQL persistence delta with `behind_by=0`. In addition to canonical persisted UUIDs, exact SQL row-count evidence, invalid-Date handling, non-object row rejection, malformed SQL-result-envelope rejection, and malformed create/revoke command validation, RED `c5b01e5fa698a5aa5ff66db984634962f1aa0a56` / GREEN `10fb68badfd5fd74a077ad0e461c2622a12d45fa` closes a durable-acceptance ambiguity where `{ rows: [undefined], rowCount: 1 }` was treated as ordinary absence. Coverage `6f0133f...` also asserts null one-row evidence rejects inside the bounded persistence-evidence contract. Only a structurally valid zero-row result denotes absence. The current restack inherits #205's new read-evidence validation without copying it into the child delta. Both PRs intentionally perform no outbound HTTP and remain active evidence rather than shipped truth.

Remaining work is concrete encrypted secret/KMS composition, SSRF/DNS-rebinding-safe outbound HTTPS with connect-time address enforcement or equivalent reviewed egress, redirect/proxy denial, finite byte/deadline limits, signed/idempotent delivery, durable attempt/outcome/retry/dead-letter evidence, revocation fencing, operator recovery, and buyer-visible status.

### #210 — reproducible release candidate

Source and CI are not a release. Active release work (#217 with stacked #236) remains unshipped evidence.

A release-ready exact protected head must produce and verify version/CHANGELOG/tag/package identity, digest-pinned OCI/migration artifacts, SPDX 3.0.1 SBOM, SLSA provenance with exact attained level, checksums/signatures, vulnerability evidence, reproducible install/upgrade/rollback, encrypted backup/restore with measured recovery evidence, and exact buyer journeys executed from immutable release artifacts. Do not claim stable/GA while another canonical P0 buyer gap remains open.

## Commercial-readiness and control-plane gaps

PR #230 hardens the read-only Actions workflow-registry evidence used by Commercial Readiness. Its current lineage fails closed on registry/tree/default-branch ambiguity but does not disable orphan workflow identities. Issue #202 remains the authorized control-plane owner for exact-state orphan disablement.

LifeOS-owned Actions lanes remain subject to the organization ruleset and central reusable workflows. Fresh cross-lane evidence on #198, #199, #218, #205, and #211 shows the same repository/security workflow families queued on unchanged heads; queue/control-plane repair belongs to #212 and its central owner paths, not a LifeOS product-source bypass. #218 remains the LifeOS-owned explicit hosted-runner selection repair and must preserve #240's workflow-safety correction when restacked.

## Documentation and traceability

Canonical PRD/TRD/Architecture/ADR/UML/security/privacy/test/operations/release documentation remains owned by its accepted documentation line, including #145 where applicable. This baseline is a product/technical gap index, not a competing architecture source.

Standards and research references belong in `docs/doctoring/REFERENCES.md` and canonical TRACEABILITY with APA 7th formatting. Maintain current traceability for ISO/IEC 25010:2023, ISO/IEC 40500:2025 / WCAG 2.2, NIST SP 800-63-4, OWASP ASVS 5.0.0, SPDX 3.0.1, SLSA 1.2, and cited goal-setting, implementation-intention, and habit-formation research. Do not turn mappings into certification claims.

GitHub Pages/public documentation is not published until protected source integration, authorized repository-settings reconciliation, successful deployment, and live HTTPS verification.

## Merge and release gate

A root PR may move to normal merge only on an unchanged exact head with live-base compatibility, terminal applicable repository/central workflows, resolved actionable review threads, and the live independent approval requirement. No self-approval, stale predecessor evidence, force-push, destructive rebase, or routine administrator bypass.

A stacked child stays Draft until its prerequisite integrates, then adopts the resulting protected ancestry non-destructively and reacquires exact-head checks/reviews. A PR is closed only when its valid delta is absent, malicious, explicitly abandoned by the user, or completely transferred to a verified successor with tests/fixtures/contracts/evidence preserved.

LifeOS is commercially complete only when an operator can install immutable release artifacts and a user can authenticate, obtain a durable personal workspace, create and connect Goal/Project/Task/Habit state, execute Today, complete Weekly Review, manage Settings/integrations/data rights, recover from expected failures, and reproduce that evidence without repository-internal knowledge.

Refs #21, #55, #129, #130, #145, #198, #199, #202, #205, #209, #210, #211, #212, #214, #216, #217, #218, #228, #230, #235, #236, #237, #238, #240.
