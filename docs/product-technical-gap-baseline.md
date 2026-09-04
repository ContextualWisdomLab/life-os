# LifeOS product and technical gap baseline

**Baseline date:** 2026-09-04 (KST)  
**Protected-main evidence commit:** `b84751674dd92bdcd0e266c7f002cdc43f5a938b`  
**Status:** code-current evidence baseline carried by active documentation PR #211 until protected integration  
**Primary commercial tracking:** #21, with canonical P0 buyer gaps #55, #129, #130, #209, and #210

This baseline separates protected shipped truth from active or work-in-progress evidence. A branch, mergeable PR, test source, queued check, successful predecessor run, or documentation claim is not shipped capability. Exact unchanged-head evidence must integrate through the live protected-branch policy before promotion.

## Canonical architecture and evidence rules

LifeOS remains a server-backed modular MSA. Planning, Habit, Review, Identity, Calendar, Integration/Plugin, Notification, AI, and other bounded contexts own their persistence, migrations, credentials, repositories, domain events, runtime authority, and recovery behavior. Cross-service SQL, copied domain source, browser-selected tenant authority, mutable sibling dependencies, and deployment-wide credentials used as per-user authority are not acceptable shortcuts.

Authentication and authorization derive workspace/user authority server-side. Durable acceptance is explicit: stale-scope, unsolicited, duplicated, malformed, impossible, conflicting, future-dated, or otherwise non-authoritative evidence cannot silently become domain truth or ordinary not-found. Sensitive access remains purpose-bound and credential values must not enter durable metadata, public errors, logs, model prompts, or retained CI artifacts.

Optional ContextualWisdomLab foundations are consumed only through released/versioned contracts and ACLs. LifeOS domain truth stays in LifeOS. LLM-backed runtime work must consume released contextual-orchestrator authority and the `orchestrator/free` virtual route rather than provider/model/group/paid-fallback policy in LifeOS.

When claims conflict, use this order: protected `main`; live AGENTS/CLAUDE/PRD/TRD/ARCHITECTURE/ADR plus executable code/contracts on that tree; exact-head active PR evidence explicitly marked unshipped; then issues, plans, historical PR bodies, and research notes. `mergeable: true`, a Draft branch, absent workflows on a non-default stacked PR, or external statuses do not constitute repository GREEN.

## P0 buyer gaps

### #209 — authenticated Goal → Project → Task → Habit → Today → Review product journey

Protected main still does not ship the complete defining first-party journey. The dependency-ordered unshipped web stack remains #214 → #237 → #238 → #225 → #226 → #229 → #231 → #232 → #233 → #234. The stack already contains authenticated BFF and durable workspace slices, but each child must preserve current ancestry and reacquire exact-head repository/security/review evidence after prerequisites integrate.

Still required are durable onboarding-to-Goal conversion with explicit local-draft attachment consent; stable authenticated navigation for Today/Goals/Projects/Tasks/Habits/Review/Settings; authoritative Planning/Habit projections in Weekly Review; Settings for locale/timezone/session/notifications/integrations/data rights/account lifecycle without becoming a persistence owner; material-UI Figma/Product Design/Storybook traceability; normal/loading/empty/error/access-denied/offline/conflict/responsive/interaction/accessibility states; KO/EN/JA/ZH/VI/ES/DE/FR screen-key parity with CJK/text-expansion/font-fallback evidence and a DB-versioned translation ledger separate from ontology labels; and release-artifact buyer E2E for new, returning, second-device, conflict, mobile, offline, and keyboard/accessibility journeys.

Applicable buyer-path API/web boundaries require current-head async E2E/k6 evidence against the repository p95 ≤ 20 ms target without sample exclusion or unrealistic warm-cache assumptions. Any miss must be profiled at query/I/O/render/runtime/framework level before stack replacement.

### #55 — tenant export and deletion orchestration

Protected main has Identity-owned orchestration and the versioned `life-os.data-rights-contributor.v1` boundary. Active #198 and #199 add Notification- and AI-owned contributors but remain unshipped.

Completion requires an explicit inventory of every persistence owner, bounded deterministic export, preflight and replay-safe owner-verified erasure, retention/legal-hold and backup-expiry outcomes, encrypted authenticated expiring artifact delivery, durable partial-failure recovery, and final success only after the exact required participant set reconciles.

#198 exact `387dc146cb9971acb040de893feadf1fb642c600` currently has Commercial Readiness success but AppGuardrail failure while CI/SAST/Security/Scorecard/OSV remain queued. Artifact-backed RCA assigns the AppGuardrail failure to scanner-owner issue `ContextualWisdomLab/appguardrail#1106`: shell/psql variable indirection was classified as a literal password, credential-free `.invalid` test database URLs as deploy-blocking credentials, and an ordinary authenticated-boundary comment as `todo-skip-auth`. LifeOS must not weaken the gate or contort source solely to satisfy those false positives; consume only a reviewed immutable owner repair and rerun the unchanged contributor head.

### #129 — per-user Calendar credential lifecycle

Protected main provides Calendar-owned connection persistence, scoped signed user authority, encrypted self-hostable secret storage, credential materialization, disconnect/read foundations, and provider adapters. Hosted production must not use deployment-wide provider credentials as request authority.

Active #216 removes deployment-wide Google/CalDAV credential authority from hosted composition; stacked #228 adds purpose-bound Google OAuth state + PKCE authority. Remaining work is a concrete PostgreSQL OAuth-state adapter/migration, bounded token exchange/refresh with single-flight fencing, verifier cleanup, authenticated hosted provider composition from exact active connection evidence, revocation/KMS cleanup recovery, provider calendar discovery/selection, restart/key-rotation evidence, and end-to-end user-scoped synchronization.

### #130 — Plugin installation, secrets, and outbound delivery

Protected main owns versioned plugin SDK/manifest preparation, host-authorized installation/grant/revocation, PostgreSQL installation evidence, credential binding, and opaque secret-reference boundaries. A manifest is intent, not capability or destination authority.

Current unshipped dependency stack is:

- #205 `301c888a9e3529054ac619bf26c9f0c0a0126e7e`: host-owned HTTPS delivery-origin authority with canonical UUID/time/origin evidence, exact-absence semantics, current-installation revalidation, and bounded trusted context. No outbound HTTP is added.
- #235 `62b83dda7f929bb5f0bfc0c9e27a67ed81554d02`: Integration-owned PostgreSQL delivery-origin persistence. Its forward migration rechecks active installation/workspace/user authority and takes `FOR SHARE` so origin admission cannot race through installation revocation. Database GREEN remains unclaimed until the real PostgreSQL contract executes on protected lineage.
- #241 `96f2f0ae8284a1fcdafc9f996fb8a012beecc83d`: credential authority/persistence hardening for malformed command/context/result evidence, canonical UUID/time/lifecycle evidence, chronology, revoke-winner continuity, and credential admission versus installation revocation. Its two-session PostgreSQL contract still requires an actual integration database and `psql`.
- #242 `6cf7e1accec331dc1a06eefe9d088083ef917947`: Plugin-owned HashiCorp Vault KV v2 adapter using opaque `lifeos-plugin-vault://` references, create-only CAS, exact replay reconciliation, redirect denial, bounded strict body handling, zeroization/cancellation, and one finite transport/read/cleanup deadline. It remains a non-default stacked Draft with no inherited repository GREEN.
- #243 `a2a8b5395c843fee6438f173659b9409d240a545`: authenticated Vault-backed `PluginOperatorApplication` composition over Integration-owned installation, credential-metadata, and durable replay ports. Only `INTEGRATION_PLUGIN_VAULT_*` configuration is accepted; generic Vault aliases are not service authority. Proposed ADR 0004 remains Proposed because hosted production acceptance is separate.
- #244 `c552fbbd94e1aaeca66d65ae30187386aea906de`: hosted Integration runtime over one service-owned SQL pool, exact `INTEGRATION_DATABASE_URL`, pre-listener authenticated operator composition, bounded lifecycle/cleanup, and concrete `PluginOperatorApplication` acceptance before Nest registration. RED `cf18caa019ec2365fb5a0d474c091bb151995a6d` proved that an object-shaped fake operator could previously cross module acceptance; exact repair `c552fbbd...` rejects that authority before listener start. Proposed ADR 0005 remains Proposed until the concrete driver and real PostgreSQL/Vault acceptance exist.

The concrete PostgreSQL/default-entrypoint successor remains deliberately outside the active PR stack on `feat/plugin-vault-postgres-driver-v1@00dcaadf1dbe686c921d4974e5bbde067a579612`. Fresh comparison against #244 is ahead-only with `behind_by=0` and five Integration-owned changed paths: the service manifest, node-postgres adapter/test, and production entrypoint/test. The branch directly declares `pg` and `@types/pg`, but the `apps/integration-service` importer in root `pnpm-lock.yaml` still lacks both entries. Therefore RED `a0b5653426f0d55e50f6baff6ad66543a57d932f` remains valid and frozen-lock/package reproducibility is not GREEN.

Fresh review of that successor found a separate process-boundary defect. The executable path previously used `void startIntegrationService()`, so a rejected PostgreSQL/Vault/runtime startup promise could escape as an unhandled rejection and leave process termination/log rendering outside the service contract. RED `20f68c860666364b261619a7eab147bebf4a26dd` requires a rejected hosted startup to produce one credential-free nonzero process failure. Repair `a02e34801cb62d6a683bc79a35306e9f31493069` adds `runIntegrationServiceEntrypoint`, consumes the rejection, emits only `Integration service startup failed.`, and sets exit code 1 without interpolating provider/database error detail. Coverage follow-up `00dcaadf1dbe686c921d4974e5bbde067a579612` covers successful startup, credential-bearing rejection, and stderr failure so a broken stderr cannot recreate the unhandled-rejection path. Exact `00dcaad...` has no PR-triggered workflow runs because this remains WIP outside the active PR stack; the committed tests are source evidence, not executed package/repository GREEN.

The next accepted #130 dependency is an atomic manifest+frozen-lock repair on this same successor lineage, followed by real PostgreSQL + Vault acceptance on protected lineage. Only then should delivery move to independently reviewed connect-time SSRF/DNS-rebinding-safe outbound HTTPS (or an immutable reviewed egress contract), redirect/proxy denial, finite byte/deadline limits, signing/idempotency, durable attempt/outcome/retry/dead-letter/recovery evidence, revocation fencing, operator recovery, and buyer-visible state. Do not source-copy Calendar secret storage, borrow another bounded context pool, use generic `DATABASE_URL`, or consume a mutable external dependency.

### #210 — reproducible release candidate

Source and CI are not a release. Active release work #217 with stacked #236 remains unshipped. A release-ready exact protected head must produce and verify version/CHANGELOG/tag/package identity, digest-pinned OCI/migration artifacts, SPDX 3.0.1 SBOM, SLSA provenance with exact attained level, checksums/signatures, vulnerability evidence, reproducible install/upgrade/rollback, encrypted backup/restore with measured recovery evidence, and exact buyer journeys executed from immutable release artifacts. Stable/GA is not credible while another canonical P0 buyer gap remains open.

## Commercial-readiness and control-plane boundary

PR #230 hardens read-only Actions workflow-registry evidence; issue #202 owns authorized orphan workflow-state mutation. LifeOS-owned lanes remain subject to live organization rules and central reusable workflows. Queued or absent evidence is not success, and central scanner/runner defects are repaired at their canonical owner rather than through leaf workflow weakening.

AppGuardrail owner issue #1106 remains the active RCA path for the #198 detector false positives. The LifeOS workflow continues to pin an immutable scanner commit and keeps detector-contract verification, evidence redaction, SARIF/evidence retention, and deploy enforcement intact.

## Documentation, publication, and release truth

AGENTS, CLAUDE, PRD, TRD, ARCHITECTURE, ADRs, DATA_MODEL/ERD/UML/API contracts, SECURITY/THREAT_MODEL, TEST_STRATEGY, OPERABILITY/recovery, RELEASE_AND_MIGRATION, standards/research traceability, CHANGELOG, and this baseline must describe current code maturity rather than future intent as shipped truth. Proposed decisions remain Proposed until their prerequisites execute and integrate.

`docs/index.md` and README links are source prerequisites only. GitHub Pages is not published evidence until repository settings, deployment, and live HTTPS are verified. No active documentation PR, Draft stack, or WIP branch creates a release, certification, product-completeness claim, or production credential.
