# Production Kubernetes reference slice

## Objective

Close the highest-weight unresolved buyer gap `deployment.production-reference` with a provider-neutral, reviewable deployment contract rather than implying that repository manifests provision a complete production platform.

## Evidence-first scope

1. Add a Kustomize base and production overlay for only the current web and gateway edge workloads.
2. Encode Restricted Pod Security, non-root/read-only execution, dropped capabilities, seccomp, resource bounds, probes, rolling updates, disruption budgets, topology spread, disabled service-account tokens, ClusterIP exposure, and default-deny networking.
3. Keep immutable image digests and the exact HTTPS web origin as mandatory deployment inputs. Commit only non-deployable sentinels.
4. Provide a manual workflow protected by the `production` environment. Validate and render before approval, then repeat validation, optionally apply forward-only migrations, perform server-side dry-run and diff, apply, and verify rollout.
5. Add a migration runner that discovers registered service migrations lexically, serializes application, records SHA-256 evidence, replays exact migrations idempotently, and fails if an applied file changes.
6. Add deterministic repository tests for all security and workflow invariants.
7. Document prerequisites, secret ownership, migration order, verification, rollback, and explicit deferred capabilities.

## Safety decisions

- No push-triggered production deployment.
- No administrative bypass, force apply, or force rollback.
- No Kubernetes Secret manifest or credential in source control.
- No public Ingress or LoadBalancer because TLS, DNS, WAF, and ingress ownership are provider/operator decisions.
- No database-backed service deployment until image packaging and service-specific probes/configuration are reviewed.
- No tag-only image reference; the deployment workflow accepts SHA-256 digests only.
- No mutable migration file after application; digest mismatch is a blocking error.
- No destructive automated schema rollback.

## Verification

- `pnpm --filter @life-os/backup-recovery-contract test`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `docker compose config --quiet`
- repository AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human/security review gates

## Rollback

Application rollout failure restores the prior web and gateway Deployment revisions. Namespace policy and successfully applied forward migrations remain in place. A schema-incompatible rollback requires a reviewed forward fix or a separately rehearsed database recovery decision.

Refs #83 and #21.
