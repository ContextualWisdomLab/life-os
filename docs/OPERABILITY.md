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

Optional provider outage may yield explicit degraded behavior where unrelated domains remain safe. Owning persistence, signing authority, replay store, or required KMS absence must fail the affected durable/secret operation closed.

## Observability

- structured bounded credential-free logs;
- correlation, request, idempotency, fencing, and evidence IDs where implemented;
- bounded operator-only metrics;
- no cookies, bearer credentials, secret handles, plaintext credentials, raw prompts/responses, hidden reasoning, provider bodies, or unbounded tenant content;
- explicit failure class and dependency boundary without reflecting attacker-controlled identifiers;
- exact source/integration/release identities on retained CI/provenance evidence.

## Protected operational boundaries

- PR #186 and PR #187 provide real authenticated Today composition; Issue #163 is completed.
- PR #157, PR #176, PR #189, PR #193, and PR #197 provide Calendar disconnect, lookup validation, read, materialization port, and secret-first creation.
- PR #179/PR #194 and PR #184/PR #192 provide protected Planning/Habit data-rights participant and transport evidence.
- PR #169, PR #172, PR #175, PR #191, and PR #196 provide durable Plugin installation/credential/operator boundaries.

These boundaries have owner-specific degraded and replay semantics and do not close #55/#129/#130.

## Failure semantics

- malformed ownership, UUIDs, signatures, issuance, one-time evidence, cursors, digests, and persisted rows fail closed;
- database outage cannot return durable-success claims;
- provider/KMS outage never falls back to plaintext or process-global caller-visible credentials;
- stale concurrent writes return explicit conflict rather than overwrite;
- workers use bounded retries/claims/backoff and retain exact replay identity;
- unknown data-rights participant state cannot become terminal completion;
- local revoke never becomes provider revoke success without proof;
- external cleanup retry never restores revoked LifeOS authority;
- plugin/operator authority never becomes arbitrary egress/tool/process/filesystem authority;
- queued, stale, predecessor, or synthetic-only checks never become release evidence.

## Incident priorities

1. preserve tenant isolation, credentials, and authority boundaries;
2. prevent false durable-success, deletion, delivery, or provider-revocation claims;
3. stop unsafe writes, secret materialization, workers, or outbound behavior;
4. retain bounded evidence needed for diagnosis and replay;
5. restore through documented rollback, forward-fix, compensation, restore, or retry;
6. reconcile partial workflows idempotently without restoring revoked authority;
7. revalidate readiness and exact protected/release identity before resuming normal operation.

## Backup and restore

**Status:** Implemented on protected main

Logical PostgreSQL backup produces integrity evidence. Restore validates artifacts and refuses unsafe non-empty targets. This does not claim PITR; WAL/archive/replication and managed backup scheduling are operator-owned until implemented and measured.

Backups preserve owning-service boundaries. A restored data-rights or credential record must still satisfy current schema, tenant, immutability, expiry/revocation, and secret-reference validation. Backup expiry remains explicit in whole-right deletion claims.

## Migration and rollback

Migrations require compatibility analysis, executable migration evidence, and rollback or forward-fix appropriate to risk. Rollback never claims to undo already committed destructive erasure, external provider revocation, delivered notification/calendar mutation, or secret-store write/delete unless a tested compensation contract exists.

Active PR #195, PR #198, and PR #199 introduce owner migrations and must prove restart, privilege, replay, and rollback/forward-fix semantics before integration. Protected PR #201 keeps compensation uncertainty fail-closed. Protected PR #200 narrows lifecycle authorization to the exact pinned OpenCode bootstrap; a fresh scheduled run remains operational acceptance evidence.

## Current operational gaps

| Gap | Status | Remaining operational evidence |
| --- | --- | --- |
| Complete data-rights participant/reconciliation/retention/protected delivery | Partial | issue #55 |
| Complete per-user Calendar KMS/OAuth/refresh/provider cleanup/discovery/scoped sync | Partial | issue #129 |
| Complete Plugin KMS/authorized egress/outcomes/retry/dead-letter/operator recovery | Partial | issue #130 |
| Central reusable scanner checkout/SARIF/status identity taxonomy | Partial | issue #132 |
| Fixed public SLO/RPO/RTO commitments | Out of scope | unavailable without measured deployment-specific evidence |

## Runbooks and recovery drills

Required drills include database outage/restore, migration failure, stale-write conflict, worker replay, NATS outage, provider timeout, KMS create/delete partial failure, Calendar create compensation, data-rights stuck participant, plugin secret cleanup, and release rollback/provenance mismatch.

Runbooks must identify owner, trigger, exact affected authority/evidence identity, safe-stop behavior, smallest recovery action, rollback/forward-fix/compensation limits, and acceptance evidence.

## SLO discipline

LifeOS publishes no fixed availability, RPO, or RTO without measured profile-specific evidence. Operator runbooks may define targets only when monitoring and repeated recovery exercises support them.

## Release operations

A release is one exact protected integrated revision plus required CI/security/review/coverage/docstrings, package/container, SBOM/provenance/reproducibility, migration/rollback, backup/restore, accessibility/localization, and operational evidence. A merged feature, generated documentation pack, model score, or configured maturity percentage is not release readiness.
