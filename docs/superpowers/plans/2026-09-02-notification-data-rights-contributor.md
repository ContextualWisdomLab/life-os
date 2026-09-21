# Notification data-rights contributor implementation plan

Status: Implemented on active PR

This plan records the executable Notification-owned portion of LifeOS data rights. Protected `main` remains authoritative until this branch is merged.

## Boundary

Notification owns reminder occurrences, immutable delivery outcomes, in-app inbox messages, the terminal workspace-erasure fence, destructive-erasure receipts, and the replay evidence used by its private signed data-rights endpoint. The Identity/Data Rights orchestration layer may invoke the versioned contributor contract but must not read or mutate `notification_service` tables directly.

The migration connection is a stable database owner and is distinct from the least-privilege Notification runtime role. An intentional migration-owner rotation is an operator-controlled database-administration change; later migrations fail closed rather than attempting to acquire ownership implicitly.

## Implemented sequence

1. Add versioned request/response contract support for `export`, `erase_preflight`, `erase`, and `verify_erased`, including the shared pagination cursor fields.
2. Add tenant-scoped export evidence that omits claim and idempotency digests, uses deterministic cross-table keyset ordering, and returns an opaque continuation cursor only when another page exists.
3. Add forward-only migrations for transaction-local outcome-deletion authorization, terminal workspace erasure fencing, replay-safe receipts, and authenticated-request replay storage.
4. Make ordinary Notification writes participate in the workspace advisory-lock protocol and reject writes after a terminal erasure fence.
5. Separate migration and runtime database authority. The migration runner verifies the established owner before migration 0002 or later and grants only the reviewed runtime privileges after migration.
6. Add a private HTTP boundary that validates a bounded signed `life-os.data-rights-context.v1` envelope, consumes durable replay authority for destructive calls, releases the claim after failed erasure, and returns credential-free problem details.
7. Compose the validated signing secret into the controller at bootstrap so later ambient-environment changes cannot alter request authentication.
8. Cover malformed authority, replay, missing privileges, same-workspace write races, erasure/replay/verification, pagination beyond 1,000 records, impossible cursor timestamps, startup configuration, migration roles, and Compose provisioning.
9. Keep `ARCHITECTURE.md`, `CHANGELOG.md`, and `docs/operations/notification-persistence.md` aligned with the active implementation and its limitations.

## Acceptance evidence

The branch is not merge-ready until one unchanged exact head has all repository-required CI, Security Scan, SAST Semgrep, AppGuardrail, Commercial Readiness, current review, and live-base compatibility evidence in terminal success under the active repository ruleset.

The current cursor is a live keyset position, not a transactionally frozen export snapshot. Multi-page snapshot consistency therefore remains an explicit data-integrity gap and must not be claimed as complete.

The current Kubernetes production reference still lacks a Notification workload, service/configuration, network-policy, image, and rollout verification. End-to-end production Notification data-rights support remains incomplete until that deployment path is implemented and proven on the integrated protected head.

## Rollback

Do not roll back by deleting Notification data-rights tables, fences, or receipts. Stop Notification scheduling/data-rights execution, deploy a compatible application version that ignores the newer schema, preserve all durable evidence, and deliver any repair as a new reviewed forward migration.
