# Planning search and quick capture implementation plan

**Goal:** Deliver a tenant-safe durable search boundary and one accessible Today capture/search surface with complete behavioral evidence.

## Task 1: Define the search contract first

- add domain tests for Unicode normalization, whitespace collapse, literal wildcard escaping, empty/numeric/control rejection, limits, deterministic ranking, and response bounds
- add PostgreSQL repository tests for one fixed parameterized query, per-entity caps, tenant scoping, normalized title predicates, row validation, and cross-tenant rejection
- add controller tests for exact query keys and workspace-header ownership

## Task 2: Implement planning search

- add `apps/planning-service/src/search.ts`
- implement `PlanningSearchRepository` in `PostgresPlanningRepository`
- wire `PlanningSearchService` through `PlanningRuntime` and `PlanningController`
- return RFC 9457-compatible credential-free failures

## Task 3: Define and implement the browser BFF

- validate fixed identity and planning origins
- forward the browser cookie only to identity session introspection
- validate the bounded session view and derive the workspace UUIDv4
- forward only `q`, `limit`, correlation identity, and `x-workspace-id` to planning
- reject redirects, timeouts, oversized bodies, malformed JSON, and upstream credential leakage

## Task 4: Build the accessible quick-capture/search component

- move the existing local capture form into `app/components/quick-capture.tsx`
- retain Today domain validation and browser-local persistence
- add durable search loading, empty, error, and result states
- keep local and durable labels explicit
- preserve keyboard operation and polite status announcements

## Task 5: Verify and document

- add unit, repository, controller, BFF, and Playwright evidence
- update package test scripts and formatting inventory
- update `CHANGELOG.md`
- verify formatting, lint, type checking, tests, build, Compose, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and every review thread on the exact head
