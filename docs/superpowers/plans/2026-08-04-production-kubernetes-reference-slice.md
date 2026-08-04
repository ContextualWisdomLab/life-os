# Production Kubernetes reference slice

## Objective

Close the highest-weight unresolved buyer gap `deployment.production-reference` with a provider-neutral, reviewable deployment contract rather than implying that repository manifests provision a complete production platform.

## Evidence-first scope

1. Add a Kustomize base and production overlay for only the current web and gateway edge workloads.
2. Encode Restricted Pod Security, non-root/read-only execution, dropped capabilities, seccomp, resource bounds, probes, rolling updates, disruption budgets, topology spread, disabled service-account tokens, ClusterIP exposure, default-deny networking, and bounded internal data paths.
3. Keep immutable image digests and the exact HTTPS web origin as mandatory deployment inputs. Commit only non-deployable sentinels and scope scanner exceptions to the two reviewed image fields.
4. Provide a manual workflow protected by the `production` environment. Use one renderer in validation and deployment, optionally apply forward-only migrations, perform server-side dry-run and diff, apply, and verify rollout.
5. Add a migration runner that creates a private libpq service file, discovers registered service migrations lexically, serializes application, records sequence and SHA-256 evidence, replays exact migrations idempotently, and blocks changed, duplicate, or retrograde migrations.
6. Add deterministic repository tests for security, workflow, renderer, connection, migration, and rollback invariants.
7. Document exact least-privilege RBAC, network ownership, secret ownership, migration order, verification, rollback, and explicit deferred capabilities.

## Safety decisions

- No push-triggered production deployment.
- No administrative bypass, force apply, or force rollback.
- No persisted checkout credential in the deployment workflow.
- No Kubernetes Secret manifest or credential in source control.
- No public Ingress or LoadBalancer because TLS, DNS, WAF, and ingress ownership are provider/operator decisions.
- No broad external egress; managed data endpoints require an operator-reviewed policy.
- No database-backed service deployment until image packaging and service-specific probes/configuration are reviewed.
- No tag-only image reference; the deployment workflow accepts SHA-256 digests only.
- No database URI in a process argument or `PGDATABASE`; use an ephemeral mode-`0600` libpq service file.
- No mutable, duplicate-numbered, or retroactively inserted migration after application.
- No destructive automated schema rollback.

## Verification

- `pnpm --filter @life-os/backup-recovery-contract test`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `docker compose config --quiet`
- Python byte-code compilation for both deployment helpers
- repository AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and human/security review gates

## Rollback

Before apply, capture whether each Deployment exists and its current revision. If rollout fails, an existing Deployment must return to the captured revision and pass `rollout status`; a first-time Deployment must be deleted and confirmed absent. Report a separate recovery failure when either verification fails. Namespace policy, non-Deployment resources, and successfully applied forward migrations remain in place. A schema-incompatible rollback requires a reviewed forward fix or a separately rehearsed database recovery decision.

Refs #83 and #21.
