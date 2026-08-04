# Changelog

All notable changes to LifeOS are documented in this file.

## Unreleased

### Added

- Tenant-safe durable planning search across goals, projects, and tasks, with Unicode-normalized exact, prefix, and whole-token matching.
- An authenticated same-origin planning-search boundary that signs the session-derived workspace context and forwards no browser credential to planning-service.
- An accessible quick-capture and search surface that keeps browser-local Today drafts visibly separate from durable workspace records.
- Complete English and Korean message catalogs, a persisted keyboard-operable language selector, localized live-region announcements, and accessibility browser journeys for the Today action loop.
- A bounded notification scheduler with IANA time-zone quiet hours, per-local-day fatigue limits, tenant-scoped atomic claims, idempotent delivery keys, and credential-free retry outcomes.
- Durable PostgreSQL reminder occurrences, expiring worker claims, immutable scheduler outcomes, and an idempotent in-app inbox in the independent `notification_service` schema.
- A bounded notification runtime that composes one PostgreSQL pool, the reminder repository, the in-app gateway, and the scheduler with exactly-once pool shutdown.
- A production AI runtime that persists every inert proposal before returning it and exposes tenant-scoped proposal evidence and append-only accept/reject decision history.
- Replay-safe AI proposal decisions bound to the exact workspace, actor, proposal revision digest, UUIDv4 idempotency key, and decision timestamp.
- A short-lived HMAC-SHA256 AI gateway context that authenticates both workspace and actor scope before proposal generation, audit retrieval, or decision recording.

### Fixed

- Planning search now normalizes browser query text and prevents stale or unmounted requests from replacing the latest visible result state.
- Reminder fatigue deferral now crosses long IANA offset fallbacks and next-day quiet hours without abandoning the claimed occurrence.
- Notification workers now recover expired claims and exact delivery replays without creating duplicate inbox messages.
- Notification batches now isolate delivery-count persistence failures, issue a distinct token for each claim attempt, share concurrent shutdown work, and emit bounded credential-free PostgreSQL failure classifications.

### Security

- Planning-search upstream responses are stopped at a fixed byte limit before they can be fully buffered by the web boundary.
- Notification persistence stores SHA-256 idempotency digests instead of raw delivery keys, validates every untrusted row, and keeps all SQL tenant-scoped and parameterized.
- The AI production boundary rejects legacy client-selected ownership headers, verifies a versioned short-lived private-gateway signature in constant time, returns credential-free problem details, and exposes no proposal apply or execution route.
