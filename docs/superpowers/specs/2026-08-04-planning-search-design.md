# Tenant-safe planning search and quick capture design

**Date:** 2026-08-04  
**Status:** Approved for the first `capture.search` slice  
**Tracking issue:** #87

## Product objective

A LifeOS user can capture a browser-local Today action immediately and search durable goals, projects, and tasks through one accessible surface. Local draft actions and durable workspace records remain visibly distinct.

## Trust boundaries

- The browser never supplies or overrides `workspace_id`.
- A same-origin Next.js BFF validates the LifeOS session through the identity service, extracts the UUIDv4 workspace identifier from the bounded session view, and forwards only that identifier to the planning service.
- The planning service validates one exact query surface, normalizes Unicode and whitespace, rejects numeric-only or control-bearing queries, and executes a fixed parameterized PostgreSQL statement.
- Search responses contain only entity type, opaque UUIDv4 identifier, original bounded title, optional parent identifier, status, and creation timestamp.
- Browser-local Today capture remains in the versioned local draft and is never represented as durable workspace data.

## Matching and ranking

The query is normalized with Unicode NFKC, collapsed whitespace, trimming, and locale-stable lowercase conversion. PostgreSQL applies the same NFKC/lower transformation to stored titles. Literal `%`, `_`, and backslash characters are escaped before `LIKE` predicates.

Results rank by:

1. exact normalized title;
2. normalized title prefix;
3. every normalized query token occurring in the title;
4. entity order: goal, project, task;
5. newest `created_at` first;
6. opaque UUIDv4 identifier ascending.

Each entity branch has an explicit cap before the final result cap, preventing one table from producing an unbounded intermediate response.

## HTTP surface

- `GET /v1/search?q=<query>&limit=<1..50>` on the planning service
- `GET /api/planning/search?q=<query>&limit=<1..50>` as the browser-facing same-origin BFF

Only `q` and `limit` are accepted. Repeated or unknown parameters fail closed. The browser-facing route forwards the session cookie only to the fixed identity origin and forwards no cookie or bearer material to planning.

## User experience

`QuickCapture` owns two explicit operations:

- **Capture locally:** creates a Today backlog action through the existing Today domain.
- **Search workspace:** queries durable planning records and renders loading, empty, error, and grouped-result states in a keyboard-operable live region.

Copy labels each data boundary so users are not misled about synchronization.

## Deferred scope

- durable quick-capture writes and idempotency
- selection of a durable parent goal or project
- language-specific PostgreSQL analyzers and full-text indexes
- habits, reviews, calendar blocks, and AI evidence
- offline mutation queues and conflict resolution
- cross-device draft synchronization
- complete Korean/English localization
