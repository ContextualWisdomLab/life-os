# Production deployment reference implementation plan

**Goal:** Produce a verified, digest-pinned Kubernetes deployment bundle without committing credentials or granting pull-request code production access.

## Task 1: Define failing deployment contracts

- add tests for the complete service inventory, Kustomize resource set, Restricted security posture, probes, resources, rolling updates, topology spread, PDBs, and NetworkPolicies
- add renderer tests for exact image-map cardinality, immutable references, deterministic output, and generic errors
- add rendered-manifest validator tests for mutable images, inline Secrets, privileged settings, missing probes, and missing resilience objects

## Task 2: Add the reusable Kubernetes base

- add namespace Pod Security Admission labels
- add the tokenless runtime ServiceAccount
- add independent Deployments and Services for every current application process
- add PodDisruptionBudgets and bounded network policy
- keep runtime ConfigMap and Secret externally managed

## Task 3: Add deterministic production rendering

- validate exact service keys and `registry/path@sha256:<64-hex>` references
- write a canonical production `kustomization.yaml`
- validate the rendered bundle before publication
- keep generated and credential-bearing files ignored

## Task 4: Add the protected workflow

- validate source and rendered Kustomize output on pull requests and `main`
- generate deterministic test evidence on unprivileged events
- accept the real digest map only from the protected `production` environment
- publish checksums and provenance for seven days
- never apply to a cluster in this slice

## Task 5: Add operator documentation and readiness evidence

- document external dependencies, configuration, migration, deployment, verification, rollback, recovery, observability, scaling, ingress, and network-policy requirements
- link issue #84 from the capability manifest
- add an Unreleased changelog entry
- include every new maintained text file in formatting checks

## Verification

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `kubectl kustomize infra/kubernetes/base`
- generate production overlay from the synthetic test digest map
- `kubectl kustomize infra/kubernetes/overlays/production`
- validate the rendered manifest
- `docker compose config --quiet`
- AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all review threads on the exact head
