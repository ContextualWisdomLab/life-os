# Production deployment reference

## Scope and trust boundary

This reference deploys the LifeOS application workloads to an existing conformant Kubernetes cluster. It does not provision a cluster, database, message broker, ingress controller, certificate, DNS zone, WAF, or secret manager. PostgreSQL and NATS are external dependencies. Production credentials never belong in Git, Kustomize output, workflow logs, or retained artifacts.

## Prerequisites

- a supported Kubernetes cluster with at least two schedulable worker nodes
- `kubectl` with Kustomize support and access through an operator-controlled identity
- an ingress controller in a namespace labeled `life-os.io/ingress-access=true`
- externally managed PostgreSQL and NATS endpoints reachable through reviewed NetworkPolicy CIDRs
- a protected GitHub environment named `production`
- one immutable container reference for every service in `infra/deployment/render-production-overlay.mjs`
- the backup and restore procedure in `docs/operations/backup-and-restore.md` rehearsed before the first production migration

## Required runtime objects

Create these objects through the platform secret/configuration system before applying the application bundle:

- `ConfigMap/life-os-runtime-config`: non-secret origins, provider mode, pool limits, internal service locations, and operational tuning
- `Secret/life-os-runtime-secrets`: PostgreSQL URLs, OAuth client secrets, OAuth encryption key ring, calendar authorization, and any provider tokens

Use exact keys required by each service runtime. Do not place unrelated secrets into the shared object in a long-lived installation; downstream overlays should split the Secret per service and update `envFrom` references. The shared names are only a portable bootstrap contract.

## Image promotion

Create a JSON object whose keys are the exact service names and whose values are complete immutable references:

```json
{
  "gateway": "ghcr.io/example/life-os-gateway@sha256:<64 lowercase hex>",
  "web": "ghcr.io/example/life-os-web@sha256:<64 lowercase hex>"
}
```

The complete set is enforced by the renderer. Tags, missing digests, duplicate keys, extra services, uppercase digest text, whitespace, and credential-bearing URLs are rejected.

Render locally:

```bash
node infra/deployment/render-production-overlay.mjs \
  --images /secure/path/image-digests.json \
  --output infra/kubernetes/overlays/production/kustomization.yaml
kubectl kustomize infra/kubernetes/overlays/production \
  > life-os-production.yaml
node infra/deployment/validate-rendered-manifest.mjs \
  life-os-production.yaml
sha256sum life-os-production.yaml
```

The generated overlay is ignored and must not be committed.

## Migration order

1. Verify a recent restorable backup and record the archive checksum.
2. Apply each service's forward-only migration using a separately authorized one-shot job or operator process.
3. Stop on the first migration failure. Do not start a new application revision against a partially understood schema state.
4. Confirm required constraints and migration records before changing workload image digests.
5. Prefer a forward fix. Use restore only when the approved recovery decision accepts the resulting recovery-point loss.

Application Deployments must not run schema-changing migrations in every replica at startup.

## Preflight

```bash
kubectl kustomize infra/kubernetes/base >/dev/null
kubectl apply --server-side --dry-run=server -f life-os-production.yaml
kubectl diff -f life-os-production.yaml
```

Inspect the diff for namespace, image digest, replicas, ConfigMap/Secret references, Service ports, NetworkPolicy, PodDisruptionBudget, and resource changes. Label only the intended ingress-controller namespace. Narrow the reference `0.0.0.0/0` and `::/0` egress blocks to the real provider CIDRs before production approval; the checked-in policy limits ports but cannot know a buyer's network ranges.

## Rollout

Apply with the operator identity after approval:

```bash
kubectl apply --server-side -f life-os-production.yaml
kubectl -n life-os rollout status deployment --timeout=10m
kubectl -n life-os get pods,services,poddisruptionbudgets,networkpolicies
```

Expose only Web and Gateway through the platform ingress/TLS layer. Keep service metrics endpoints private to the monitoring network. Run credential-free health checks first, then an authenticated synthetic journey that signs in, reads Today, and performs a reversible test operation in a dedicated workspace.

## Rollback and failed rollout

Keep the previous verified manifest and digest/provenance bundle. For an application-only regression:

```bash
kubectl apply --server-side -f previous-life-os-production.yaml
kubectl -n life-os rollout status deployment --timeout=10m
```

`kubectl rollout undo` may be used only when its ReplicaSet contains the exact previously approved digest. Never infer database compatibility from a successful Pod rollback. If the new application wrote data under a forward-only schema, use the documented forward fix or approved restore plan.

A failed readiness rollout should stop receiving traffic because the Service endpoint is removed. Investigate events, bounded logs, resource pressure, ConfigMap/Secret presence, database connectivity, and NetworkPolicy before retrying. Do not weaken probes to make a broken workload appear ready.

## Availability, capacity, and scaling

The base uses two replicas, `maxUnavailable: 0`, topology spread, and `minAvailable: 1`. This protects ordinary voluntary disruptions but is not a multi-region guarantee. Size requests/limits from measured production telemetry. Add HorizontalPodAutoscalers only after defining stable scaling signals and minimum replicas. Ensure cluster capacity can accommodate rolling-update surge and one-node loss.

## Observability and recovery

Apply the Prometheus and alerting contracts under `infra/observability/`. Route alerts to an owned incident channel and retain logs/metrics under the operator's privacy policy. Rehearse restore at least monthly and after material PostgreSQL changes. Logical dumps do not replace WAL archiving or point-in-time recovery for stricter recovery objectives.

## Modular deployment

A downstream Kustomize overlay may include a subset of objects from the `workloads-*.yaml` resources, but it must also include the matching Service, PodDisruptionBudget, ServiceAccount, required NetworkPolicies, external configuration, and dependency endpoints. Standalone services retain their documented HTTP and database boundaries; direct cross-service database access remains prohibited.

## Standards references

- Kubernetes, declarative management with Kustomize: bases, overlays, `kubectl kustomize`, and `kubectl apply -k`
- Kubernetes Pod Security Standards: Restricted profile
- Kubernetes startup, readiness, and liveness probes
- Kubernetes Deployments, PodDisruptionBudgets, topology spread constraints, NetworkPolicy, and resource management
- GitHub Actions environments, deployment protection rules, least-privilege permissions, and immutable Action references
