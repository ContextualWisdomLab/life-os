# Notification Reminder Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone notification service that evaluates UUIDv4 workspace reminders with named-time-zone quiet hours, local-day fatigue limits, atomic duplicate prevention, bounded retries, and credential-free in-app delivery evidence.

**Architecture:** Pure Node.js ESM keeps the scheduler dependency-free and independently deployable. A domain module validates and projects time, a scheduler module owns repository/delivery ports and atomic claims, and a bounded HTTP module exposes workspace-scoped scheduling, evaluation, outcomes, and inbox reads.

**Tech Stack:** Node.js 22 ESM, built-in `node:http`, `Intl.DateTimeFormat`, `node:test`, experimental built-in coverage, Turbo, pnpm, GitHub Actions.

## Global Constraints

- All internal identifiers are lowercase UUIDv4 strings; numeric identifiers are rejected.
- Titles are 1–160 Unicode code points, at most 1,024 UTF-8 bytes, and contain no C0/DEL controls.
- Timestamps are RFC 3339 and canonicalized to UTC ISO strings.
- Time zones are named zones accepted by `Intl.DateTimeFormat`.
- Quiet hours are half-open `[start, end)` intervals with unequal `HH:mm` endpoints.
- Batch size is 1–100, daily limit is 1–10, and maximum attempts is 1–5.
- No provider credentials, arbitrary destination URLs, exception messages, or provider payloads are persisted or returned.
- Every production helper has explanatory JSDoc and 100% line, branch, and function coverage.
- Database objects are deferred; any future objects must use multi-word `snake_case` names.

---

### Task 1: Package and failing domain contract

**Files:**
- Create: `apps/notification-service/package.json`
- Create: `apps/notification-service/src/reminder-domain.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tests for `createReminder`, `projectInstant`, `isQuietMinute`, `findNextPolicyInstant`, and `retryDelayMilliseconds` from `reminder-domain.mjs`.

- [ ] Write domain tests for UUIDv4, title, RFC 3339, IANA zone, quiet-hour, limit, due-boundary, DST, and retry behavior.
- [ ] Add every planned notification path to the root `format:check` inventory.
- [ ] Open a Draft PR and verify CI fails because `reminder-domain.mjs` does not exist.
- [ ] Commit with `test(notification): define reminder scheduling contract`.

### Task 2: Minimal domain implementation

**Files:**
- Create: `apps/notification-service/src/reminder-domain.mjs`

**Interfaces:**
- Produces immutable reminder/outcome constructors and time-policy helpers consumed by the scheduler.

- [ ] Implement only the behavior required by Task 1 tests.
- [ ] Enforce generic fixed validation messages without echoing values.
- [ ] Run the package test command and verify domain tests pass.
- [ ] Commit with `feat(notification): add bounded reminder domain`.

### Task 3: Failing scheduler and concurrency contract

**Files:**
- Create: `apps/notification-service/src/reminder-scheduler.test.mjs`
- Create: `apps/notification-service/src/reminder-scheduler.integration.test.mjs`

**Interfaces:**
- Consumes domain constructors and time helpers.
- Produces tests for `InMemoryReminderRepository`, `InMemoryReminderInbox`, and `ReminderScheduler`.

- [ ] Add tests for deterministic due order, hard batch limits, tenant isolation, quiet-hour deferral, next-local-day fatigue deferral, atomic concurrent claims, delivery success, retry-safe failure, and exhausted-attempt suppression.
- [ ] Verify the tests fail because scheduler exports do not exist.
- [ ] Commit with `test(notification): define atomic scheduler contract`.

### Task 4: Minimal scheduler implementation

**Files:**
- Create: `apps/notification-service/src/reminder-scheduler.mjs`

**Interfaces:**
- Produces repository and delivery-port contracts plus in-memory reference adapters.
- `ReminderScheduler.schedule(workspaceId, input, now)` creates a reminder.
- `ReminderScheduler.runDueBatch(workspaceId, now, batchSize)` returns evaluation outcomes.

- [ ] Implement synchronous-in-method claim mutation before every delivery call.
- [ ] Require matching claim tokens for completion and clone every returned record.
- [ ] Record exactly one fixed-schema outcome per evaluation.
- [ ] Run unit and integration tests to green.
- [ ] Commit with `feat(notification): add atomic reminder scheduler`.

### Task 5: Failing HTTP boundary contract

**Files:**
- Create: `apps/notification-service/src/main.test.mjs`

**Interfaces:**
- Consumes the scheduler and adapters.
- Produces tests for `createNotificationApplication`, `createNotificationRequestHandler`, and `readBoundedJsonBody`.

- [ ] Test health, reminder creation/listing, run-due, outcomes, inbox, exact keys, ownership injection, UUIDv4 headers, body/content-type limits, no-store headers, fixed problem details, and cross-tenant isolation.
- [ ] Verify tests fail because `main.mjs` does not exist.
- [ ] Commit with `test(notification): define HTTP boundary contract`.

### Task 6: Minimal standalone HTTP service

**Files:**
- Create: `apps/notification-service/src/main.mjs`

**Interfaces:**
- `createNotificationApplication(options)` returns repository, inbox, scheduler, and clock.
- `createNotificationRequestHandler(application)` returns a Node request listener.
- `startNotificationServer(environment)` validates `NOTIFICATION_SERVICE_PORT` and starts the process.

- [ ] Implement the six exact routes from the design.
- [ ] Bound request bodies to 16 KiB and return RFC 9457-style credential-free problems.
- [ ] Ensure JSON cannot supply `workspaceId`, IDs, outcomes, claims, or provider fields.
- [ ] Run tests with 100% line, branch, and function coverage.
- [ ] Commit with `feat(notification): expose reminder service boundary`.

### Task 7: Repository integration and commercial evidence

**Files:**
- Modify: `product/capabilities.json`
- Modify: `CHANGELOG.md`
- Modify: `.env.example`
- Create: `docs/operations/notification-reminders.md`

**Interfaces:**
- Registers issue #98 and exact implementation/test evidence for `notifications.reminders`.

- [ ] Set `tracking_issue` to 98 without weakening target maturity or replacing implementation/test probes with documentation.
- [ ] Add `NOTIFICATION_SERVICE_PORT=4105` to the example environment.
- [ ] Document trust boundaries, local-time semantics, retry/suppression states, operational limitations, and the PostgreSQL/provider follow-up.
- [ ] Add an Unreleased changelog entry.
- [ ] Commit with `docs(notification): register reminder capability evidence`.

### Task 8: Exact-head validation and merge

**Files:**
- Modify only files required by concrete review or Check evidence.

- [ ] Run formatting, syntax/lint, typecheck, 100% coverage tests, root tests, build, and Compose validation.
- [ ] Inspect CI, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, human reviews, and every unresolved thread on the exact current head.
- [ ] Investigate root causes before each fix; implement one verified fix at a time.
- [ ] Remove Draft only after the implementation is reviewable.
- [ ] Merge only when the exact head has successful required Checks, no requested changes, no unresolved actionable thread, and no base drift.
- [ ] Confirm issue #98 and the living readiness issue reflect the merged evidence, then select the next highest buyer-visible gap.
