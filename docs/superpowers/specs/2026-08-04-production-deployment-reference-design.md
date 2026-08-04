# Production deployment reference design

**Date:** 2026-08-04  
**Status:** Approved by the autonomous commercial-readiness mandate  
**Tracking issue:** #84

## Objective

Close the `deployment.production-reference` buyer gap with a cloud-neutral, fail-closed Kubernetes reference that preserves LifeOS as both a complete MSA product and a set of independently deployable services.

## Chosen approach

Use a reusable Kustomize base plus a generated production overlay. The base contains no credentials and uses local image aliases. A deterministic renderer accepts an exact map of immutable image digests and creates the production overlay. CI renders and validates that output; a protected GitHub production environment may publish the verified bundle, but this slice does not hold cluster credentials or mutate an arbitrary cluster.

This is preferred over a provider-specific Terraform stack because it keeps the product portable, and over committing placeholder production digests because that would create false deployability evidence.

## Workload boundary

The reference composes Web, Gateway, Identity, Planning, Habit, Review, AI Proposal, Calendar Integration, and Plugin Integration workloads. Every Deployment and Service remains a separate Kubernetes object with stable labels and may be selected into a smaller downstream overlay. PostgreSQL and NATS remain external managed dependencies.

## Security model

The namespace enforces the Kubernetes Restricted Pod Security Standard. Workloads run non-root, disable service-account token automount, use RuntimeDefault seccomp, drop all capabilities, prevent privilege escalation, and use read-only root filesystems with a bounded `/tmp` volume. No Secret object is committed. Required runtime configuration and secrets are supplied through externally managed `life-os-runtime-config` and `life-os-runtime-secrets` objects.

NetworkPolicy denies ingress and egress by default, permits same-namespace service traffic, DNS, labeled ingress-controller namespaces, HTTPS provider calls, and PostgreSQL/NATS ports. Operators must narrow public CIDRs to provider-specific ranges before production approval.

## Reliability model

Each public and core service starts with two replicas, zero-unavailable rolling updates, startup/readiness/liveness HTTP probes, bounded resource requests and limits, topology spreading, termination grace, and a PodDisruptionBudget requiring one available replica. These settings establish a conservative reference rather than a universal sizing claim.

## Delivery and evidence

A dependency-light renderer and validator produce deterministic Kustomize output, reject missing or extra services, malformed or mutable image references, unsafe workload settings, missing probes/resources/PDBs, inline Secrets, and incomplete network policy. The GitHub workflow validates on pull requests and `main`, and publishes a seven-day bundle with SHA-256 checksums and exact source provenance. Production publication runs only from `main` behind a protected `production` environment.

## Operations and rollback

The runbook defines prerequisite configuration, forward-only migrations, digest promotion, preflight rendering, progressive rollout, smoke checks, rollback to the previous digest bundle, backup/restore dependency, and failed-rollout handling. Database schema rollback is never implied; operators restore or forward-fix according to the service migration runbooks.

## Standards basis

The design follows current Kubernetes guidance for Kustomize bases and overlays, Pod Security Standards, HTTP probes, Deployment rolling updates, PodDisruptionBudgets, topology spread, resource management, and NetworkPolicy. The workflow follows current GitHub Actions guidance for least-privilege permissions, concurrency, immutable Action references, protected environments, and bounded deployment artifacts.

## Explicit non-goals

- cluster provisioning
- in-cluster PostgreSQL or NATS operation
- provider-specific ingress, DNS, WAF, TLS, or secret-manager resources
- multi-region active-active claims
- unattended production cluster mutation
- automatic reverse database migration
