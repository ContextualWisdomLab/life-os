# Durable Today workspace synchronization design

**Date:** 2026-08-09  
**Status:** Implemented on active PR #127  
**Issue:** #121

## Problem

The Today interface originally persisted only in browser `localStorage`. That protects privacy and offline usability but does not satisfy a signed-in user who expects the same plan on another device. A naive background sync would create a worse failure mode: a stale tab or second device could silently overwrite newer state, and a browser-local plan could be uploaded without the user deliberately choosing to make it durable.

## Decision

Add one planning-owned, versioned durable Today aggregate keyed by authenticated workspace and user-local calendar date. Keep the browser-local draft as a distinct copy. Durable reads and writes happen only after explicit user actions.

### Authority boundaries

- Browser owns the local draft and chooses only the date/document it wants to inspect or save.
- Identity-service owns session validity and the workspace bound to the session.
- Web BFF derives the workspace and signs the trusted planning context.
- Planning-service owns aggregate validation, PostgreSQL state, idempotency, optimistic concurrency, and revision rotation.
- The user owns reconciliation direction after a conflict.

The browser cannot provide a workspace identifier. Planning-service receives no browser cookie or bearer credential.

## Aggregate contract

`life-os.today.v1` contains:

- local date;
- complete ordered action collection;
- opaque aggregate UUIDv4;
- opaque revision UUIDv4;
- bounded action UUIDv4/title/status/priority/schedule/completion fields.

One `(workspace_id, local_date)` row is authoritative. The wire response carries the opaque revision both in the body and as a strong HTTP `ETag`.

## Mutation contract

### Create

A first save requires `If-None-Match: *` plus a UUIDv4 `Idempotency-Key`. Creation fails if the aggregate already exists.

### Update

A later save requires exactly one strong quoted `If-Match` equal to the last explicitly observed revision. A successful update keeps the aggregate ID and rotates the revision token.

### Conflict

A stale update returns 409 `today_revision_conflict` with only `currentRevision`. The server does not send the newer document in the conflict response. The client keeps its local draft and requires a new explicit GET before a user can choose either copy.

### Replay

An exact idempotency-key/request-digest replay returns the original result, including its original revision and document, even if the aggregate advanced later. Reusing that key for a different digest is a hard conflict.

## Persistence and concurrency

Planning-service owns `planning.today_aggregates` and `planning.today_idempotency_records`. SQL is fixed and parameterized. One advisory-locked statement serializes the aggregate/idempotency decision, validates the current revision, performs create/update, records replay evidence, and returns one bounded outcome.

Restart persistence, cross-workspace isolation, concurrent same-revision contenders, exact replay, and conflicting key reuse are verified against real PostgreSQL.

## Browser migration flow

1. Local Today loads from browser storage with no workspace request.
2. User selects **Check workspace Today**.
3. If missing, local state remains unchanged and the user may explicitly migrate it.
4. If found, local state remains unchanged and the user may explicitly load workspace state or replace it with local state.
5. A save conflict preserves local state and requires another explicit check.
6. Dependency failure preserves local state and does not infer overwrite authority from a failed response.

No effect or mount callback automatically uploads local Today.

## Error and privacy design

- Bounded response bodies are read before JSON parsing.
- Accepted media types are restricted to JSON/problem JSON.
- Browser cookies are bounded and forwarded only to identity-service.
- Planning-service errors are mapped to stable problem shapes.
- Public stale-write evidence contains an opaque revision only, never action content.
- No delete endpoint is included in this slice.
- Calendar, reminders, habits, reviews, and AI proposals are outside the planning write transaction.

## Accessibility

Sync state is text, not color-only. Status changes use a polite live region. Every state transition is initiated through keyboard-operable native buttons. Browser acceptance runs the same journeys in desktop and mobile Chromium projects.

## Alternatives considered

### Automatic background sync

Rejected. It violates the explicit migration/privacy contract and creates silent overwrite risk.

### Last-write-wins timestamp

Rejected. Clock ordering does not prove the writer observed the state it is replacing and hides concurrent edits.

### Partial PATCH merge

Deferred. Today scheduling/priorities have aggregate-level invariants; accepting partial merges would require a separately designed conflict model.

### Browser-selected workspace

Rejected. Tenant ownership must derive from authenticated server context.

### Cross-service shared Today table

Rejected. Planning owns its database; integrations must use APIs/events.

## Acceptance

The slice can become Ready only when the exact head has deterministic unit/integration coverage, real PostgreSQL concurrency/restart evidence, browser migration/conflict journeys, CI browser acceptance, security scans, CodeRabbit/review evidence, and required repository documentation. Canonical root documentation touched concurrently by PR #126 must be reconciled after that branch is integrated rather than raced.
