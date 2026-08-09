# LifeOS Operability and Deployment Boundary

**Baseline:** protected `main` at `876850018a17323900844e79845ba395b7bf6a9a`

## 1. Purpose

This document is the operator-facing index for what upstream LifeOS supplies and what a deployment owner must supply. Detailed procedures remain in `docs/operations/`.

LifeOS does not turn a reference Compose/Kubernetes configuration into an operated SLA, managed database, managed cluster, managed identity provider, or managed secret store.

## 2. Deployment profiles

### Local development / Compose

**Status:** Implemented on protected main

Repository composition supports local development/self-hosting with LifeOS services and declared local dependencies. Operators still supply valid environment secrets/provider registrations where a feature needs them.

Use this profile for:

- contributor development;
- disposable integration testing;
- self-hosted evaluation;
- recovery/backup rehearsal where the runbook permits it.

Do not infer production HA, PITR, ingress/TLS or secret-manager guarantees from local Compose.

### Portable self-hosted runtime

**Status:** Partial

The repository provides a modular self-hostable composition and explicit service ownership, while production-grade external PostgreSQL/NATS, secret management, network/ingress, provider credentials and operated availability remain deployment-owner responsibilities. This status describes upstream operational completeness, not a collapse of the accepted modular architecture.

### Kubernetes production reference

**Status:** Implemented on protected main

Current repository artifacts encode a provider-neutral hardened reference with non-root/read-only containers, probes, resource bounds, rolling update/disruption/topology/network policies and protected deployment workflow behavior. `Reference` is a scope qualifier, not a separate status value.

They deliberately do **not** provision:

- a Kubernetes cluster/control plane;
- PostgreSQL;
- NATS JetStream;
- ingress controller/WAF;
- TLS certificates or DNS;
- image registry/build pipeline;
- KMS/secret manager;
- cloud IAM/private networking;
- operator monitoring backend.

## 3. Operator-owned configuration

Deployment owners are responsible for, at minimum:

- Google/GitHub OAuth application registration and redirect policy;
- database/NATS credentials and network access;
- signing/encryption/provider keys;
- per-environment allowed origins;
- external calendar/model provider tenant/accounts;
- production ingress/TLS/DNS;
- encrypted backup storage and retention;
- monitoring/alert routing;
- incident response/on-call processes;
- legal basis, privacy notice, retention/deletion policy and subprocessors;
- security patch deployment and dependency upgrade cadence.

Upstream repository defaults/examples are not production secrets.

## 4. Health, readiness and metrics

Services expose health/readiness/metrics according to their implemented contracts. Health endpoints answer process/component questions only to the extent documented by the owning service; they must not claim a downstream provider is usable if the probe does not test that dependency.

Prometheus-compatible metrics are an **operator surface**. Production ingress must restrict metrics appropriately because labels/counts/timing can expose operational or tenant-sensitive metadata even without raw personal content.

Public diagnostics must remain:

- bounded;
- credential-free;
- free of raw stack traces and dependency bodies;
- stable enough to classify retry/conflict/unavailable behavior.

## 5. Observability

Use existing service/runbook contracts for exact metric names and SLO calculations. Repository-wide expectations are:

- correlation/request identifiers where applicable;
- structured logs;
- bounded metric label cardinality;
- request/error/latency/queue/database saturation evidence appropriate to the service;
- no raw personal action text, provider tokens, prompts/responses or browser cookies in telemetry;
- exact provider/model/deployment provenance in retained evidence when needed without retaining secret values.

Canonical architecture documentation does not invent global numeric SLA/SLO targets. Numeric objectives belong to measured operator/service-specific SLO documents.

## 6. External dependency degradation

| Dependency | Expected degradation |
| --- | --- |
| Google/GitHub identity provider | New login/link flows may fail; unrelated domain data must not fabricate authentication success |
| PostgreSQL for owning service | Durable operations for that service fail closed/classified; no in-memory fallback that pretends persistence succeeded |
| NATS | Event-driven projections/notifications may lag/fail according to owning contract; source-of-truth DB writes do not become unauthorized cross-service writes |
| Calendar provider | Synchronization returns retry/conflict/unavailable evidence; local LifeOS truth remains intact |
| Model/contextual-orchestrator | AI live proposal/conformance may be unavailable; deterministic LifeOS gates remain meaningful |
| Plugin/external integration | That integration fails independently; no direct database repair/access |

A degraded external provider is never permission to weaken tenant/auth/security validation.

## 7. Backup and recovery

**Current tier:** verified PostgreSQL logical dump/restore.

Protected-main backup tooling/runbook provides:

- private custom-format archive;
- checksum/non-secret metadata;
- restore checksum verification;
- explicit empty-target requirement;
- integration evidence for corruption and unsafe-target refusal.

It does **not** claim:

- point-in-time recovery;
- automatic backup scheduling;
- encrypted off-site replication;
- retention enforcement;
- continuous WAL archival;
- a universal RPO/RTO.

Deployment owners establish independent encrypted storage and recovery objectives. If required RPO is shorter than logical dump cadence, implement/rehearse WAL/PITR at the operated PostgreSQL layer.

See `docs/operations/backup-and-restore.md`.

## 8. Migration and rollout

- Database migrations are service owned.
- Production workflow migration/application order must be explicit.
- A completed forward migration is not automatically reversed by workload rollback.
- Changes that require compatibility windows document old/new application/schema coexistence.
- Migration failure evidence is credential-free and does not hide partial state.
- Destructive data migration requires explicit backup/recovery and review evidence.

## 9. Deployment rollback

The reference deployment workflow captures the existence/revision of covered workloads before apply, performs protected-environment dry-run/diff, and verifies rollback/deletion semantics for the workload resources it claims to recover.

Do not overstate rollback:

- completed DB migrations may persist;
- namespace/policy/external infrastructure may not be reversed;
- first-time workloads may require verified deletion rather than revision rollback;
- recovery failure is a distinct failure, not success-with-warning.

See `docs/operations/production-deployment.md`.

## 10. Secrets and key rotation

- Secrets enter runtime through protected environment/secret-management boundaries, not Git.
- Browser/model/public artifacts never receive unrelated service credentials.
- AI/model live tests use `NVIDIA_NIM_API_KEY` only at the approved model boundary.
- Review-agent credentials are not repurposed for development agents.
- Signed service-context keys use explicit active/overlap/retirement semantics where implemented.
- Provider-specific token rotation/revocation belongs to the owning integration/identity service and operator configuration.

Hosted Google Calendar unattended synchronization remains incomplete until durable per-user credential storage/refresh/revocation is implemented and operationally documented under issue #129.

## 11. Incident categories

At minimum classify incidents into:

- authentication/session/provider failure;
- cross-tenant authorization suspicion;
- database availability/integrity;
- replay/duplicate side effect;
- notification/calendar provider degradation;
- model/provider/prompt-injection anomaly;
- privacy grant/access anomaly;
- backup/restore failure;
- deployment/rollback failure;
- CI/supply-chain/release compromise;
- data/credential leakage.

Security-sensitive incidents follow private vulnerability/incident channels rather than public issue detail.

## 12. Operational evidence for release

Before a stable release, verify on one exact integrated protected head:

- CI/security/dependency checks;
- package/container build/smoke evidence;
- owned-code coverage gates;
- supported PostgreSQL migration/integration behavior;
- backup/restore rehearsal;
- production-reference render/dry-run/deployment contract tests;
- accessibility/localization browser journeys;
- SBOM/provenance according to release workflow;
- runbook/doc links for changed operator behavior;
- no obsolete temporary repair workflow/source.

## 13. Runbook index

Canonical operator details live in existing runbooks, including:

- `docs/operations/service-level-objectives.md`
- `docs/operations/planning-service-level-objectives.md`
- `docs/operations/backup-and-restore.md`
- `docs/operations/production-deployment.md`
- `docs/operations/notification-persistence.md`
- AI proposal/orchestrator assurance and key-rotation runbooks under `docs/operations/`

Feature runbooks remain authoritative for exact commands/configuration they own; this document supplies the repository-wide operational boundary.
