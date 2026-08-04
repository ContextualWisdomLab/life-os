# Production Kubernetes reference deployment

## Purpose

This reference deploys the current public LifeOS web application and gateway as a hardened, provider-neutral Kubernetes edge. It is intentionally smaller than the complete service topology: identity, planning, habit, AI, review, calendar, notification, PostgreSQL, NATS, ingress, TLS, DNS, image builds, and managed secret systems remain separately operated capabilities until each has an immutable image and reviewed deployment contract.

The repository does not claim that committing these manifests creates a production environment. A production operator must provide the cluster, network-policy enforcement, image artifacts, environment protection, access controls, monitoring, backup policy, and public edge.

## Reviewed resources

- `infra/kubernetes/base` is the reusable Kustomize base.
- `infra/kubernetes/overlays/production` composes the production reference without provider-specific resources.
- `infra/kubernetes/render-production-manifest.py` is the single renderer used by validation and deployment.
- `.github/workflows/deploy.yml` is a manual, serialized deployment path protected by the GitHub `production` environment.
- `infra/kubernetes/write-pg-service.py` converts one protected database URI into an ephemeral libpq service file.
- `infra/kubernetes/run-migrations.sh` applies service SQL in lexical order with an advisory lock, digest evidence, and monotonic sequence enforcement.
- `infra/tests/deployment.spec.ts` and `infra/tests/deployment-scripts.spec.ts` fail CI when deployment contracts regress.

## Cluster prerequisites

Use a supported Kubernetes release compatible with the `v1.36` Restricted Pod Security policy label in `namespace.yaml`. The cluster must provide:

1. at least two schedulable worker nodes for useful disruption and topology-spread behavior;
2. a NetworkPolicy implementation that enforces ingress and egress policy;
3. DNS pods in `kube-system` labeled `k8s-app: kube-dns`, or an operator-reviewed patch for the cluster DNS labels;
4. server-side apply and the `policy/v1` PodDisruptionBudget API;
5. a separately managed ingress or service-mesh namespace labeled `life-os.io/edge-access=true` before it can reach the web or gateway ClusterIP services;
6. a GitHub environment named `production` with required reviewers or equivalent deployment protection;
7. a least-privilege cluster credential stored only as the environment secret `LIFE_OS_KUBE_CONFIG_B64`.

### Least-privilege deployment identity

The workflow applies one cluster-scoped `Namespace`. Inside `life-os`, it applies `ConfigMap`, `ServiceAccount`, `Service`, `Deployment`, `PodDisruptionBudget`, and `NetworkPolicy` objects; reads and watches Deployments; patches a prior Deployment revision; and deletes a newly created Deployment only when an initial rollout fails and no prior revision exists.

Provision the deployment principal outside this repository with the following maximum permissions. Substitute the actual authenticated user, group, or service account in the bindings. Do not grant `cluster-admin`, wildcard resources, wildcard verbs, Secret access, RBAC mutation, node access, or access to another namespace.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: life-os-namespace-deployer
rules:
  - apiGroups: ['']
    resources: ['namespaces']
    verbs: ['get', 'create', 'patch']
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: life-os-workload-deployer
  namespace: life-os
rules:
  - apiGroups: ['']
    resources: ['configmaps', 'serviceaccounts', 'services']
    verbs: ['get', 'create', 'patch']
  - apiGroups: ['apps']
    resources: ['deployments']
    verbs: ['get', 'list', 'watch', 'create', 'patch', 'update', 'delete']
  - apiGroups: ['policy']
    resources: ['poddisruptionbudgets']
    verbs: ['get', 'create', 'patch']
  - apiGroups: ['networking.k8s.io']
    resources: ['networkpolicies']
    verbs: ['get', 'create', 'patch']
```

Bind the ClusterRole at cluster scope and the Role only in `life-os`. Before storing the kubeconfig, verify the effective identity. Every required command must return `yes`, and representative forbidden commands must return `no`:

```bash
kubectl auth can-i get namespaces --as=<deployment-principal>
kubectl auth can-i create namespaces --as=<deployment-principal>
kubectl auth can-i patch namespaces --as=<deployment-principal>
kubectl auth can-i get deployments.apps --namespace life-os --as=<deployment-principal>
kubectl auth can-i watch deployments.apps --namespace life-os --as=<deployment-principal>
kubectl auth can-i create deployments.apps --namespace life-os --as=<deployment-principal>
kubectl auth can-i patch deployments.apps --namespace life-os --as=<deployment-principal>
kubectl auth can-i update deployments.apps --namespace life-os --as=<deployment-principal>
kubectl auth can-i delete deployments.apps --namespace life-os --as=<deployment-principal>
kubectl auth can-i create networkpolicies.networking.k8s.io --namespace life-os --as=<deployment-principal>
kubectl auth can-i get secrets --namespace life-os --as=<deployment-principal>
kubectl auth can-i create clusterrolebindings.rbac.authorization.k8s.io --as=<deployment-principal>
```

The last two checks must be `no`. Repeat the complete resource-and-verb matrix after any workflow change.

## Immutable application images

The base deliberately contains all-zero SHA-256 sentinels. They cannot pass the deployment workflow. Supply the two approved organization-owned GHCR image paths with immutable digests:

```text
ghcr.io/contextualwisdomlab/life-os-web@sha256:<64 lowercase hexadecimal characters>
ghcr.io/contextualwisdomlab/life-os-gateway@sha256:<64 lowercase hexadecimal characters>
```

The workflow rejects alternate registries and repository paths. Moving image ownership requires a separately reviewed change to the renderer, manifests, provenance policy, and scanner annotation rather than an unreviewed deployment input. The two inline Trivy exceptions are attached only to those exact image fields; there is no repository-wide registry exception.

The images must start as UID/GID `10001`, listen on ports `3000` and `4000`, work with a read-only root filesystem, and use `/tmp` for bounded temporary files. The web image must serve `/offline`; the gateway image must serve `/v1/health`. Do not change probes merely to make an incompatible image appear healthy.

The shared renderer replaces each sentinel exactly once in an isolated copy, renders the production overlay, and rejects unresolved sentinels. Both workflow jobs call the same implementation. The workflow never writes a generated manifest back to the repository.

## Public origin, ingress, and egress

Provide `web_origin` as an exact credential-free HTTPS origin with no path, query, fragment, username, or password. The value becomes the gateway `CORS_ALLOWED_ORIGINS` setting. Multiple origins are not accepted; expanding the trust boundary requires a reviewed change.

The reference creates only ClusterIP services. It does not create an Ingress, public load balancer, TLS certificate, or DNS record. The operator-owned ingress controller namespace must carry the label:

```bash
kubectl label namespace <ingress-namespace> life-os.io/edge-access=true
```

Restrict that label through cluster admission policy. Removing it withdraws edge ingress without changing LifeOS workloads.

The base denies all ambient traffic, then permits DNS, edge ingress, web-to-gateway TCP `4000`, and gateway egress to explicitly named LifeOS pods on service ports `4101` through `4107`, NATS `4222`, and PostgreSQL `5432`. The current gateway endpoint is a placeholder and does not yet require PostgreSQL or NATS, but these internal paths are ready for separately deployed, correctly labeled LifeOS services.

Managed PostgreSQL, managed NATS, and external APIs are intentionally still blocked. Before enabling them, add an operator-owned NetworkPolicy or CNI-native FQDN policy containing only the reviewed destination CIDRs or names and exact ports. Never use `0.0.0.0/0` as a convenience fallback. Confirm the provider's endpoint stability, private routing, DNS behavior, and failover addresses before rollout.

## Secret boundary

No Kubernetes Secret is committed or generated by this slice. The edge workloads require no application credential. Private registry credentials, ingress certificates, database URLs, OAuth material, and provider tokens belong in an external secret manager or pre-created namespace Secret with separate access review.

Kubernetes Secret values are not encrypted merely because they are base64 encoded. Enable encryption at rest, least-privilege RBAC, audit access, and short rotation periods at the cluster layer.

## Forward-only migrations

Application processes never apply SQL at startup. Before rolling out a database-backed service image, load each required database URI from the approved secret manager into the named environment variable. Execute the migration runner from the repository root with `python`, `psql`, `sha256sum`, and `mktemp` available:

```bash
export IDENTITY_DATABASE_URL
export PLANNING_DATABASE_URL
export HABIT_DATABASE_URL
export AI_DATABASE_URL
export REVIEW_DATABASE_URL
export LIFE_OS_MIGRATION_CONFIRMATION=apply-forward-only
bash infra/kubernetes/run-migrations.sh
```

Do not type connection strings into shell history or commit example credentials. The protected workflow injects these values only into the migration step.

For each service, `write-pg-service.py` reads the URI from its environment variable, validates the host, user, database path, port, and an explicit allowlist of libpq query parameters, and writes a mode-`0600` service file in a private temporary directory. The runner unsets the URI variable and invokes `psql` through `PGSERVICEFILE` and `PGSERVICE`. It never assigns a URI to `PGDATABASE` and never places the URI in a process argument. The temporary service file and command file are removed after success or failure.

The runner discovers SQL files lexically under each registered service migration directory. For each database, it creates `life_os_deployment.schema_migrations`, records the service name, migration filename, four-digit sequence, SHA-256 digest, status, and application timestamp, and serializes changes with a PostgreSQL advisory lock. The `(service_name, migration_sequence)` index is unique. A new sequence must be greater than every sequence already recorded for that service, so duplicate numeric prefixes and retroactively added lower-numbered migrations fail with `migration_sequence_not_forward`.

An exact completed replay is skipped. A previously recorded filename whose digest changed fails closed. The ledger records `applying` before a migration file is executed and `applied` only after the file succeeds. Because service migration files retain their own transaction boundaries, an interrupted or failed run can leave an `applying` record. A later run refuses to guess whether the schema changed. An operator must inspect the database and migration evidence, then complete or reconcile the migration through a reviewed repair procedure.

Leave the workflow's `run_migrations` input disabled for the current web/gateway-only edge rollout unless database migrations are intentionally part of the reviewed release. Migrations are forward-only. Back up and rehearse restore before applying one. If an application rollback follows a successful schema migration, the prior image must remain compatible with the forward schema. Otherwise deploy a reviewed forward fix; do not destructively reverse production data through the workflow.

## Deployment procedure

1. Merge only after CI, security, commercial-readiness, CodeRabbit, and human review gates pass on the exact head.
2. Build and scan the web and gateway images through a separate reviewed image pipeline. Publish them only to the approved organization-owned GHCR paths and record their immutable digests.
3. Confirm the `production` environment approval policy, least-privilege kubeconfig, network policies, and environment secrets.
4. Review the Kustomize output locally while remembering that the committed image and origin values are non-deployable sentinels.
5. Manually run **Deploy Production Reference** for the intended Git commit. Supply both approved image digests and the exact HTTPS origin. Enable migrations only when the release plan requires them.
6. Approve the protected environment after reviewing the selected revision and validation job.
7. Review the server-side dry-run and diff. The workflow applies with field manager `life-os-deployer` and waits up to ten minutes for both Deployments.
8. Confirm two ready and available replicas for each workload, health responses, ingress routing, CORS behavior, metrics access restrictions, and absence of unexpected egress.

## Rollback and failure handling

Before applying the rendered manifest, the workflow records whether each Deployment exists and, when present, its current revision. A failed rollout follows one of two paths:

- An existing Deployment is rolled back explicitly to the captured revision, and `kubectl rollout status` must confirm recovery.
- A Deployment created for the first time is deleted, and a subsequent lookup must confirm that it is absent.

The workflow does not ignore rollback errors. It exits with a distinct failure when either workload cannot be restored to its captured state. Only after both verification paths succeed does it report that the captured workload state was restored. The namespace, namespace policy, services, configuration, network policies, completed migrations, external ingress, certificates, DNS, and secret rotations are outside this workload-state rollback and may remain changed.

For an operator-directed rollback:

```bash
kubectl rollout history deployment/life-os-web --namespace life-os
kubectl rollout history deployment/life-os-gateway --namespace life-os
kubectl rollout undo deployment/life-os-web --namespace life-os --to-revision=<revision>
kubectl rollout undo deployment/life-os-gateway --namespace life-os --to-revision=<revision>
kubectl rollout status deployment/life-os-web --namespace life-os --timeout=10m
kubectl rollout status deployment/life-os-gateway --namespace life-os --timeout=10m
```

Investigate failed probes, scheduling, Pod Security admission, image startup identity, read-only filesystem assumptions, network policy, and image provenance before retrying. Do not weaken Restricted policy, probes, resource bounds, or digest pinning as a recovery shortcut.

## Security and availability properties

The reference uses a dedicated namespace, Restricted Pod Security admission, non-root fixed identities, runtime-default seccomp, dropped Linux capabilities, disabled privilege escalation, read-only root filesystems, bounded temporary storage, resource requests and limits, startup/readiness/liveness probes, rolling updates with zero unavailable pods, two replicas, disruption budgets, topology spread, disabled service-account token automount, ClusterIP services, default-deny networking, and explicit ingress and egress allowlists.

These controls reduce common deployment risk but do not replace cluster hardening, image signing and provenance verification, admission control, node isolation, runtime detection, external observability, disaster recovery, capacity testing, or incident response.

## Standards basis

- Kubernetes, *Declarative Management of Kubernetes Objects Using Kustomize*: https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/
- Kubernetes, *Using RBAC Authorization*: https://kubernetes.io/docs/reference/access-authn-authz/rbac/
- Kubernetes, *Pod Security Standards*: https://kubernetes.io/docs/concepts/security/pod-security-standards/
- Kubernetes, *Liveness, Readiness, and Startup Probes*: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes, *Good practices for Kubernetes Secrets*: https://kubernetes.io/docs/concepts/security/secrets-good-practices/
- PostgreSQL, *The Connection Service File*: https://www.postgresql.org/docs/current/libpq-pgservice.html
- PostgreSQL, *Environment Variables*: https://www.postgresql.org/docs/current/libpq-envars.html
