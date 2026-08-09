# LifeOS Operability Contract

**Status:** Accepted architecture  
**Baseline:** protected `main` at `2cd8c766d2c8358936eac1f92e44c8e9f99f1fea`

## 1. Operating boundary

LifeOS provides application source, migrations, Compose configuration, backup/restore tooling, health/metrics surfaces and a provider-neutral Kubernetes reference. Operators remain responsible for the actual cluster/host, PostgreSQL, NATS, ingress/TLS/DNS, registry, secret manager, external-provider registrations, network policy, backup retention and incident response.

The repository must not convert a reference manifest into an unmeasured SLA or managed-infrastructure claim.

## 2. Deployment profiles

### Local/self-hosted Compose

**Status:** Implemented on protected main

Compose is intended for development and bounded self-hosted composition. It does not collapse service ownership merely because multiple services share a physical PostgreSQL/NATS deployment.

### Kubernetes reference

**Status:** Implemented on protected main

The committed Kubernetes/Kustomize artifacts are a hardened reference for current edge/application workloads. They do not provision the surrounding platform dependencies and committed sentinel image/origin values are not production configuration.

### Hosted multi-user calendar

**Status:** Partial

Issue #129 owns per-user encrypted calendar credential lifecycle/provider selection. The current provider adapter must not be operated as though a process-global development token were a complete hosted credential model.

## 3. Health and readiness

A service's health/readiness endpoint must reflect the responsibility actually required to receive traffic. Liveness must not claim that an external dependency is usable when the service contract requires that dependency for the probed operation.

Public readiness/errors remain bounded and do not expose credentials, DSNs, internal stack traces or unbounded dependency responses.

## 4. Observability

- structured bounded logs;
- correlation/evidence identifiers where implemented;
- Prometheus-compatible operator metrics where implemented;
- metrics restricted from public production ingress;
- no raw browser cookies, provider/model credentials, export payloads or hidden reasoning in logs/metrics/artifacts;
- error classes distinguish validation/authentication/authorization/conflict/dependency/rate-limit/unexpected failure without dependency internals.

Numeric SLO/SLA targets belong in measured scoped runbooks. Repository prose does not manufacture deployment-specific availability guarantees.

## 5. PostgreSQL operations

Each bounded service owns its migrations and credentials. Operators may co-locate schemas in one physical cluster, but roles and access must preserve service ownership.

Migration procedure:

1. identify exact application and migration revisions;
2. back up according to risk and recovery requirements;
3. validate migration against a representative disposable database where practical;
4. apply in owning-service order;
5. verify service health, schema constraints and critical queries;
6. use documented rollback/forward-fix behavior rather than assuming all migrations are reversible.

## 6. NATS operations

NATS/JetStream is an external durable transport dependency where configured. Operators own availability, storage and security configuration. Consumers remain replay-safe/idempotent according to their contract; application code never converts redelivery into an uncontrolled duplicate side effect.

## 7. Backup and restore

**Status:** Implemented on protected main

The upstream logical backup/restore tier provides archive/checksum/metadata evidence and refuses known unsafe restore conditions. It does not itself provide:

- point-in-time recovery;
- WAL archive infrastructure;
- automatic scheduling/retention;
- cross-region replication;
- operator key-management policy.

Operators establish independent encrypted storage, retention, recovery objectives and restore rehearsals.

## 8. Data-rights operations

**Status:** Partial

Protected main now includes recent-authenticated request handling foundations and a durable identity-owned request/receipt ledger. Issue #55 still requires complete contributor orchestration, durable reconciliation, operator-visible stuck requests, retention/legal-hold and protected export delivery.

Operational dashboards/runbooks must not call a request complete merely because the identity ledger row exists.

## 9. Calendar operations

**Status:** Partial

- conflict-safe provider adapters are protected-main behavior;
- PR #139 is active trusted-workspace-context hardening;
- encrypted per-user credentials, refresh/revocation and calendar discovery/selection remain issue #129;
- provider outages degrade synchronization, not unrelated planning state;
- provider response bodies/tokens do not enter public diagnostics.

## 10. Plugin runtime operations

**Status:** Planned

Issue #130 requires bounded installation, capability grants, encrypted secret handles, SSRF-safe delivery, retry/dead-letter or paused state, audit and immediate revocation before generic plugin runtime can be operated.

## 11. AI/model operations

Deterministic product behavior remains independent of live provider availability. Scheduled/manual model conformance uses bounded credentials and retains only validated credential-free metrics/evidence. A provider outage is not transformed into a source pass or a product-data mutation path.

Repository development automation must not receive product credentials or become a merge/release administrator.

## 12. Incident classes

| Incident | First response |
| --- | --- |
| Tenant boundary suspicion | Stop/contain affected write path, preserve bounded audit evidence, investigate cross-tenant scope before re-enable. |
| Database migration failure | Halt dependent rollout, inspect exact migration state, use documented rollback/forward-fix; never blindly rerun destructive SQL. |
| NATS outage | Preserve local transaction truth, bound retries, verify consumer replay after recovery. |
| Provider outage | Degrade only provider-dependent operation; avoid infinite retry loops. |
| Credential exposure | Revoke/rotate, contain artifacts/logs, investigate history/caches, do not assume deleting latest file removes exposure. |
| Data-rights stuck request | Preserve request identity/receipt evidence, identify incomplete contributor, do not claim completion. |
| AI/provider anomaly | Disable/bound live route while deterministic validation remains authoritative. |
| CI/security evidence ambiguity | Identify exact checked-out SHA/tree before making merge claims. |

## 13. Release operations

Release preparation is performed only from one exact protected integrated head. Operators verify migrations, package/container artifacts, SBOM/provenance, backup/restore, accessibility/browser acceptance and external dependency configuration before deployment.

Application rollback does not imply rollback of already completed database migrations or external-provider side effects.

## 14. Operability change rule

Any change to deployment dependencies, required environment variables, health/readiness semantics, migrations, backup/restore, provider credentials, worker retry behavior, observability or incident recovery updates this document/runbook and executable operational tests in the same reviewed change.