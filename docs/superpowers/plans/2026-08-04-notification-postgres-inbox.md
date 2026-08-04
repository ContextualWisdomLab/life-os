# Durable Notification Claims and Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for each behavior and superpowers:verification-before-completion before merge.

**Goal:** Persist reminder occurrences, claims, outcomes, and in-app delivery evidence in a dedicated PostgreSQL bounded context without changing the existing scheduler port.

**Architecture:** A forward-only migration defines only multi-word snake_case database objects. `PostgresReminderRepository` implements the scheduler repository plus bounded tenant reads/writes, `PostgresInAppDeliveryGateway` provides idempotent credential-free delivery, and `NotificationRuntime` owns the pool and composes both with `ReminderScheduler`.

**Tech Stack:** TypeScript 5.9, PostgreSQL, `pg`, Vitest, Node crypto, pnpm, Turbo, GitHub Actions.

## Task 1: Migration contract first

- [ ] Add `apps/notification-service/migrations/0001_durable_reminder_inbox.sql`.
- [ ] Add a migration contract test that rejects any one-word schema/table/column/index/constraint name.
- [ ] Verify UUIDv4, bounds, enum, paired quiet-hours, hash-length, and retry/terminal consistency constraints.
- [ ] Commit `test(notification): define durable reminder schema contract`.

## Task 2: Repository tests before implementation

- [ ] Add `postgres-reminder-repository.test.ts` with a recording SQL client.
- [ ] Define tests for fixed parameterized statements, SHA-256 claim hashes, deterministic row mapping, response caps, tenant predicates, exact replay, and malformed/cross-tenant failure.
- [ ] Verify tests fail because repository exports do not exist.
- [ ] Commit `test(notification): define PostgreSQL repository contract`.

## Task 3: Minimal repository and in-app gateway

- [ ] Implement `postgres-reminder-repository.ts`.
- [ ] Keep claim acquisition one conditional update with a bounded lease.
- [ ] Keep each state transition and outcome insertion atomic in one statement.
- [ ] Implement exact idempotent inbox insertion and conflict verification.
- [ ] Run focused tests to green.
- [ ] Commit `feat(notification): add durable reminder repository`.

## Task 4: Runtime tests and implementation

- [ ] Add `notification-runtime.test.ts` for URL validation, pool bounds, exact application name, shared pool composition, and exactly-once close.
- [ ] Implement `notification-runtime.ts` and export production symbols from `main.ts`.
- [ ] Add `pg`, Nest shutdown typing, and `@types/pg` dependencies consistently with other services.
- [ ] Commit `feat(notification): wire PostgreSQL reminder runtime`.

## Task 5: Real PostgreSQL evidence

- [ ] Add `postgres-reminder-repository.integration.test.ts`.
- [ ] Apply the migration to a clean schema.
- [ ] Prove restart durability and deterministic due ordering.
- [ ] Prove two workers cannot claim one occurrence and that an expired lease is recoverable.
- [ ] Prove tenant-isolated reads/counts and malformed ownership rejection.
- [ ] Prove in-app replay creates one message and conflicting replay fails closed.
- [ ] Prove delivered, quiet/fatigue-deferred, retryable-failed, and terminal-failed transitions persist correct immutable outcomes.
- [ ] Commit `test(notification): verify durable reminder persistence`.

## Task 6: Product and operational evidence

- [ ] Correct the obsolete 26-hour statement in the prior scheduler design.
- [ ] Add runtime variables to `.env.example`.
- [ ] Add `docs/operations/notification-persistence.md` with migration, claim recovery, replay, privacy, and rollback boundaries.
- [ ] Register implementation/test evidence and tracking issue #103 in `product/capabilities.json` without weakening target maturity.
- [ ] Update `CHANGELOG.md`.
- [ ] Add every source, test, migration, and document to formatting/lint inventories.
- [ ] Commit `docs(notification): register durable inbox evidence`.

## Task 7: Exact-head verification and merge

- [ ] Run formatting, lint, type checking, tests, build, Compose, and real PostgreSQL integration validation.
- [ ] Inspect CI, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, human reviews, and every unresolved thread on the exact head.
- [ ] Apply only evidence-backed fixes and rerun all affected checks.
- [ ] Remove Draft only when reviewable.
- [ ] Merge only the exact successful head with no requested changes, unresolved actionable thread, or base drift.
- [ ] Confirm issue #103 closes and select the next buyer-visible notification gap.
