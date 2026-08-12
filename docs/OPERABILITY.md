# LifeOS Operability

**Status:** Implemented on active PR

## Deployment profiles

### Self-hosted composition

**Status:** Implemented on protected main

Docker Compose composes independent LifeOS workloads with operator-owned PostgreSQL, NATS, secrets and provider configuration. Compose is a deployment profile, not a shared-service authority model.

### Kubernetes reference

**Status:** Implemented on protected main

The repository provides provider-neutral Kubernetes/Kustomize reference artifacts with restricted defaults. Operators remain responsible for cluster provisioning, TLS/DNS/ingress, managed PostgreSQL/NATS, registry, secret management, backup storage and environment-specific network policy.

## Liveness and readiness

Liveness reports process/runtime health. Readiness must fail when a service cannot safely serve its contracted workload. Dependency-specific readiness must not be collapsed into generic process health. Metrics/readiness endpoints remain bounded and operator-facing.

## Observability

- structured credential-free logs;
- correlation/evidence IDs where implemented;
- bounded Prometheus-compatible metrics;
- no raw prompts/responses, bearer credentials, cookies or unbounded tenant text in retained operational evidence;
- provider failures classified without replaying upstream bodies.

## Failure semantics

- malformed authority/signatures/UUIDs fail closed;
- service database outage cannot return durable-success claims;
- provider outage degrades only the affected integration where possible;
- stale concurrent writes return explicit conflict rather than silently overwriting;
- retryable workers use bounded retries/claims and preserve replay identity;
- unknown data-rights participant state cannot become completed deletion/export.

## Backup and restore

**Status:** Implemented on protected main

Logical PostgreSQL backup produces integrity evidence. Restore validates artifact integrity and refuses unsafe non-empty targets. This does not claim point-in-time recovery; WAL/archive/replication are operator-owned until explicitly implemented and measured.

## Migration and rollback

Schema changes require compatibility analysis, executable migration evidence and a rollback or forward-fix strategy appropriate to risk. Application rollback must not claim that already-completed irreversible database or external-provider changes are automatically reverted.

## Incident priorities

1. preserve tenant isolation and credentials;
2. prevent false durable-success/data-loss claims;
3. stop unsafe writes/delivery;
4. retain bounded evidence needed for diagnosis;
5. restore service through documented rollback/forward-fix/replay procedures;
6. reconcile delayed background work idempotently.

## Current operational gaps

- complete data-rights orchestration/reconciliation, retention and protected delivery: **Partial**, issue #55;
- per-user hosted calendar credential lifecycle: **Partial**, issue #129;
- plugin runtime delivery/secrets/revocation: **Planned**, issue #130;
- repository-wide exact contributor-head verification attribution: **Planned**, issue #132.

## SLO discipline

LifeOS does not publish fixed availability/RPO/RTO values without measured deployment-specific evidence. Runbooks may define profile-specific targets only when monitoring and recovery exercises support them.

## Release operations

A release is an exact protected integrated revision plus its CI/security/review/coverage/package/SBOM/provenance/migration/recovery/accessibility/operational evidence. A merged feature, generated documentation pack or 100% configured readiness score alone is not a release.