# Guided review service slice

## Goal

Deliver the first durable `review.guided-loop` slice so users can record daily planning, daily shutdown, and weekly review completion evidence without allowing the Review service to mutate Planning or Habit data.

## Architecture

The Review service owns an append-only `guided_review.review_completions` PostgreSQL table. The trusted HTTP boundary derives workspace ownership only from `x-workspace-id`. The domain validates an exact bounded request, computes a canonical SHA-256 payload digest, and delegates immutable idempotency and period enforcement to a parameterized repository. The production runtime owns one bounded PostgreSQL pool and closes it exactly once.

## Security and privacy boundaries

- Request JSON cannot contain workspace ownership or unknown fields.
- Identifiers are UUIDv4 and database constraints repeat that validation.
- Reflection text and evidence counts are bounded.
- Persistence errors and HTTP problem details never include SQL, credentials, hostnames, exception messages, or record contents.
- The Review service has no Planning, Habit, Calendar, Identity, notification, command-bus, or mutation dependency.
- Migrations are operator-applied and never run during application startup.

## Behavior

- `POST /v1/reviews/daily-planning/completions`
- `POST /v1/reviews/daily-shutdown/completions`
- `POST /v1/reviews/weekly-review/completions`
- `GET /v1/reviews/completions?limit=50`

One completion is allowed per workspace, ritual kind, and local period. Identical idempotent replays return the persisted record. Reusing an idempotency key or occupied period with different immutable evidence returns a conflict. Weekly periods must start on Monday. History is tenant-scoped, bounded to 100 records, and ordered newest first with deterministic tie breakers.

## Verification

- domain tests cover exact input, ownership rejection, period rules, count bounds, digest stability, and service construction
- repository tests cover parameterized SQL, validated rows, exact replay, conflict rejection, tenant filtering, and credential-free failure behavior
- runtime tests cover bounded configuration and exactly-once shutdown
- controller and HTTP tests cover all public routes and bounded problem details
- optional PostgreSQL integration tests prove restart durability, tenant isolation, deterministic ordering, replay behavior, and absence of mutation capability

## Deferred

Trusted gateway actor context, read-only Planning/Habit snapshot adapters, guided step definitions, incomplete-session recovery, reminder scheduling, Review SLOs, export/erasure participation, and user-interface flows remain follow-up reviewable slices.
