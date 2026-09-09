# LifeOS Operability, Incident, and Recovery

**Status:** Implemented on active PR

## Deployment profiles

### Self-hosted composition

**Status:** Implemented on protected main

Docker Compose composes independent LifeOS workloads with operator-owned PostgreSQL, NATS, secrets, and provider configuration. Compose is a deployment profile, not shared persistence or credential authority.

### Kubernetes reference

**Status:** Implemented on protected main

Kubernetes/Kustomize artifacts are provider-neutral restricted references. Operators own cluster provisioning, TLS/DNS/ingress, managed PostgreSQL/NATS, registry, KMS/secret stores, backup storage, network policy, egress controls, identity/provider configuration, and monitoring.

## Runtime ownership and shutdown

Each service owns process configuration, database pool, migrations, provider clients, health/readiness, metrics/logs, graceful shutdown, and retry/recovery. Shared process composition cannot create cross-service table authority.

Shutdown must:

1. reject new work where required;
2. stop/await workers and in-flight bounded operations;
3. release claims/leases according to owner semantics;
4. close provider clients and database pools exactly once;
5. emit bounded credential-free terminal evidence.

## Liveness and readiness

Liveness reports process/runtime viability. Readiness fails when a service cannot safely serve the contracted workload. Dependency-specific readiness must not be collapsed into generic process health.

Optional provider outage may yield explicit degraded behavior where unrelated domains remain safe. Owning persistence, signing authority, replay store, required secret store/KMS, or required released gateway authority absence must fail the affected durable/secret/model operation closed.

## Observability

- structured bounded credential-free logs;
- correlation, request, idempotency, fencing, and evidence IDs where implemented;
- bounded operator-only metrics;
- no cookies, bearer credentials, secret handles, plaintext credentials, Vault credentials, raw prompts/responses, hidden reasoning, provider bodies, or unbounded tenant content;
- explicit failure class and dependency boundary without reflecting attacker-controlled identifiers;
- exact source/integration/release identities on retained CI/provenance evidence.

## Protected operational boundaries

- PR #186 and PR #187 provide real authenticated Today composition; Issue #163 is completed.
- PR #157, PR #176, PR #189, PR #193, PR #197, PR #201 and PR #203 provide Calendar disconnect, lookup validation, read, materialization, secret-first creation/compensation and encrypted self-hosted secret storage.
- PR #179/PR #194, PR #184/PR #192 and PR #195 provide protected Planning/Habit/Review data-rights participant evidence.
- PR #169, PR #172, PR #175, PR #191, and PR #196 provide durable Plugin installation/credential/operator boundaries.
- PR #200 protects only the exact reviewed OpenCode bootstrap boundary.

These boundaries have owner-specific degraded and replay semantics and do not close #55/#129/#130/#209/#210.

## Active operational boundaries

- #216 rejects deployment-wide Google/CalDAV credentials in hosted multi-user composition; #228 adds bounded OAuth state/PKCE ceremony authority but not token exchange or refresh/provider cleanup.
- #242/#243/#244/#245 compose Vault KV v2 and one Integration-owned PostgreSQL pool for the hosted Plugin runtime. Retained real Vault+PostgreSQL lifecycle acceptance on an exact #245 ancestor is valuable recovery evidence but not current-head merge authority.
- #250 adds signed delivery-origin grant/read/revoke application authority and deliberately stops before public delivery-origin HTTP transport/outbound networking.
- #214/#229/#234 are active first-party journey evidence; browser-visible completion still requires current-head E2E/all-state/a11y/Figma/Storybook/8-locale acceptance.
- #208 consumes contextual-orchestrator/`orchestrator/free` but remains fail-closed until the canonical owner authentication/bootstrap contract is repaired and immutably released.
- #217/#236 validate release evidence/signatures but do not publish a release.

No active line is production authority until normal protected integration.

## Failure semantics

- malformed ownership, UUIDs, signatures, issuance, one-time evidence, cursors, digests, and persisted rows fail closed;
- database outage cannot return durable-success claims;
- provider/Vault/KMS outage never falls back to plaintext or process-global caller-visible credentials;
- Calendar hosted configuration cannot replace user-owned credentials with deployment-global provider values;
- stale concurrent writes return explicit conflict rather than overwrite;
- workers use bounded retries/claims/backoff and retain exact replay identity;
- unknown data-rights participant state cannot become terminal completion;
- local revoke never becomes provider revoke success without proof;
- external cleanup retry never restores revoked LifeOS authority;
- plugin/operator origin authority never becomes arbitrary egress/tool/process/filesystem authority;
- a stored HTTPS origin is not authorization for later DNS/IP/redirect/proxy resolution;
- missing immutable contextual-orchestrator owner capability fails the model-assisted lane closed rather than selecting a direct provider;
- queued, stale, predecessor, synthetic-only, or temporary-writer-only checks never become release evidence.

## Incident priorities

1. preserve tenant isolation, credentials, and authority boundaries;
2. prevent false durable-success, deletion, delivery, provider-revocation, or release claims;
3. stop unsafe writes, secret materialization, workers, or outbound behavior;
4. retain bounded evidence needed for diagnosis and replay;
5. restore through documented rollback, forward-fix, compensation, restore, or retry;
6. reconcile partial workflows idempotently without restoring revoked authority;
7. revalidate readiness and exact protected/release identity before resuming normal operation.

## Backup and restore

**Status:** Implemented on protected main

Logical PostgreSQL backup produces integrity evidence. Restore validates artifacts and refuses unsafe non-empty targets. This does not claim PITR; WAL/archive/replication and managed backup scheduling are operator-owned until implemented and measured.

Backups preserve owning-service boundaries. A restored data-rights, OAuth-state, credential, or delivery-origin record must still satisfy current schema, tenant, immutability, expiry/revocation, and secret-reference validation. Backup expiry remains explicit in whole-right deletion claims.

## Migration and rollback

Migrations require compatibility analysis, executable migration evidence, and rollback or forward-fix appropriate to risk. Rollback never claims to undo already committed destructive erasure, external provider revocation, delivered notification/calendar mutation, consumed OAuth ceremony state, Vault/secret-store write/delete, or immutable release publication unless a tested compensation contract exists.

Review PR #195 is now protected. Active #198/#199 introduce Notification/AI owner migrations. Active Calendar/Plugin stacks introduce additional owner-specific persistence/runtime obligations and must prove restart, privilege, replay, compensation and rollback/forward-fix semantics before integration. Protected #201 keeps Calendar compensation uncertainty fail-closed.

## Current operational gaps

| Gap | Status | Remaining operational evidence |
| --- | --- | --- |
| Complete data-rights participant/reconciliation/retention/protected delivery | Partial | issue #55 |
| Complete per-user Calendar OAuth/token/refresh/provider cleanup/discovery/scoped sync and hosted secret lifecycle | Partial | issue #129 |
| Complete Plugin canonical egress/outcomes/retry/dead-letter/operator recovery | Partial | issue #130 |
| Complete first-party buyer journey with all states/a11y/Figma/Storybook/8 locales/current-head E2E | Partial | issue #209 |
| Immutable protected release with package/SBOM/provenance/signature/trust/reproducibility/rollback/recovery | Partial | issue #210 |
| Central reusable scanner checkout/SARIF/status identity taxonomy | Partial | issue #132 |
| Fixed public SLO/RPO/RTO commitments | Out of scope | unavailable without measured deployment-specific evidence |

## Runbooks and recovery drills

Required drills include database outage/restore, migration failure, stale-write conflict, worker replay, NATS outage, OAuth expiry/replay and callback failure, provider timeout, Vault/KMS create/delete partial failure, Calendar create compensation, data-rights stuck participant, plugin credential/origin revocation races, delivery retry/dead-letter once introduced, contextual-orchestrator auth/capability outage, release provenance/signature/trust-root mismatch, rollback and forward-fix.

Runbooks identify owner, trigger, exact affected authority/evidence identity, safe-stop behavior, smallest recovery action, rollback/forward-fix/compensation limits, and acceptance evidence.

## Verification-writer recovery

Purpose-bounded writer workflows are not permanent operational dependencies. A writer may change only its declared owner paths, prove the intended exact source, and retire by deleting only itself through an ordinary descendant after success. If its environment omits a declared runtime prerequisite—such as a workspace package whose `main` points to built `dist`—repair the harness by building the dependency; do not skip the full suite or reinterpret a collection failure as product GREEN.

## SLO discipline

LifeOS publishes no fixed availability, RPO, or RTO without measured profile-specific evidence. Operator runbooks may define targets only when monitoring and repeated recovery exercises support them.

## Release operations

Issue #210 remains Partial. Active #217/#236 narrow structural and cryptographic evidence validation. A release is one unchanged protected integrated revision plus version/CHANGELOG/tag/immutable package or image, required CI/security/review/coverage/docstrings, browser/accessibility/localization, SBOM/provenance/signatures/trust lifecycle/reproducibility, migration/rollback, backup/restore, installed buyer-path verification and operational evidence. A merged feature, generated documentation pack, model score, ancestor GREEN, or configured maturity percentage is not release readiness.
