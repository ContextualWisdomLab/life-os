# Durable Today synchronization runbook

**Status:** Implemented on active PR #127  
**Owner:** Planning bounded context with web BFF mediation

## Purpose

This runbook covers the durable Today aggregate introduced for cross-device planning. Browser-local Today remains a separate local draft. No page load, capture, schedule change, or completion automatically uploads that local draft.

## Runtime boundaries

- Browser calls only the same-origin web BFF.
- The BFF introspects the browser session with identity-service and derives the workspace UUID server-side.
- The browser cookie is never forwarded to planning-service.
- The BFF signs a short-lived workspace context with `PLANNING_GATEWAY_CONTEXT_SECRET` and forwards only bounded Today data plus conditional/idempotency headers.
- Planning-service owns the PostgreSQL tables, revision rotation, idempotency replay, and conflict decision.
- Calendar, habit, notification, review, and AI services must not read or mutate the Today tables directly.

## Required runtime configuration

The web/BFF path requires:

- `IDENTITY_SERVICE_ORIGIN`
- `PLANNING_SERVICE_ORIGIN`
- `PLANNING_GATEWAY_CONTEXT_SECRET` with at least 32 bytes

Planning-service requires:

- `PLANNING_DATABASE_URL`
- the same trusted gateway-context secret through the existing planning-service configuration contract
- migration `apps/planning-service/migrations/0003_durable_today_sync.sql`

Secrets must be injected through deployment secret management. Do not place them in browser bundles, logs, issue comments, screenshots, retained workflow artifacts, or repository fixtures.

## User workflow

### First durable save

1. User creates or edits the browser-local Today plan.
2. No workspace request occurs automatically.
3. User selects **Check workspace Today**.
4. When no aggregate exists, the UI reports that the local draft remains unchanged.
5. User selects **Move local draft to workspace**.
6. Browser sends a fresh UUIDv4 idempotency key and `If-None-Match: *` through the BFF.
7. Planning-service creates the aggregate atomically and returns a strong opaque revision in `ETag`.

### Existing aggregate

1. User explicitly checks workspace Today.
2. BFF returns the complete bounded aggregate and strong `ETag`.
3. User may explicitly use workspace state in the browser or replace workspace state with the current local draft.
4. Replacement sends the last observed revision in `If-Match` and a fresh idempotency key.

### Stale-device conflict

A stale `If-Match` returns HTTP 409 with machine code `today_revision_conflict` and only `currentRevision`. The response does not contain the current Today document.

The client must:

1. keep the local draft unchanged;
2. tell the user another device changed Today;
3. require **Check workspace Today** again;
4. after the fresh read, let the user explicitly choose workspace state or explicitly replace it.

Do not automatically retry a stale write with the newly exposed revision. Doing so would convert conflict detection into silent overwrite authority.

## Dependency outage and retry

Identity or planning dependency failures are represented as browser-safe unavailable states. The local draft remains the working copy. To retry safely:

1. user rechecks workspace state;
2. if absent, a new explicit create can use `If-None-Match: *`;
3. if present, the newly observed `ETag` becomes the only valid update precondition;
4. a client must not reuse a revision learned only from a failed or malformed response.

An exact idempotency-key retry is allowed to return the original response even after later revisions. Reusing the same key for a different request digest fails closed.

## Database model

Planning-service owns:

- `planning.today_aggregates`
- `planning.today_idempotency_records`

The aggregate primary key is `(workspace_id, local_date)`. Public aggregate and revision identities are opaque UUIDv4 values. Writes use fixed parameterized SQL and advisory-lock serialization so concurrent contenders cannot both commit from the same observed revision.

## Verification

Before merge or release, require exact-current-head evidence for:

- planning domain/unit tests;
- real PostgreSQL restart, tenant-isolation, concurrent-update, replay, and conflicting-key tests;
- BFF authentication/credential-separation tests;
- browser explicit-migration and stale-conflict journeys;
- CI browser acceptance in Chromium;
- formatting, lint, typecheck, build, Compose validation;
- AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all actionable human/automated review findings.

A predecessor-head pass does not transfer after any source or base change.

## Diagnosis guide

| Symptom | First boundary to inspect | Safe action |
| --- | --- | --- |
| Browser shows sign-in required | identity `/v1/session` | Verify session validity; do not add client-selected workspace IDs. |
| Browser shows workspace unavailable | BFF dependency call or bounded-response validation | Inspect exact upstream status/timeout without exposing payloads; retry only after a fresh user action. |
| `today_revision_conflict` | current aggregate revision | Preserve local state and perform a fresh explicit read. |
| `today_idempotency_conflict` | idempotency-key/request digest pair | Generate a new key for a genuinely new request; never coerce the stored record. |
| Repeated database serialization failure | planning PostgreSQL statement/lock boundary | Inspect transaction evidence and current revision; do not weaken optimistic concurrency. |
| Cross-workspace result | authenticated context / SQL tenant predicate | Treat as a security incident; fail closed and stop release. |
| Browser acceptance fails before app starts | Playwright/browser bootstrap | RCA runner/dependency failure separately from product behavior; do not mark browser journey passing. |

## Rollback

The feature has no destructive Today delete route. If application rollback is required after schema deployment, leave the new tables in place until a separately reviewed forward migration or data-retention decision exists; do not drop durable user state merely to match an older binary. Older binaries must not be granted direct access to the new tables.
