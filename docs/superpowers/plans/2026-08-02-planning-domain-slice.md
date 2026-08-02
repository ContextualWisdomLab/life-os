# Planning Domain Slice

**Goal:** Implement the first usable Planning bounded-context slice with tenant-safe Goal → Project → Task behavior and a PostgreSQL migration.

## Tasks

- [x] Define domain types and validation rules for Goal, Project, and Task.
- [x] Implement a workspace-scoped repository contract and in-memory reference implementation.
- [x] Prove tenant isolation and parent-child ownership with tests.
- [x] Expose workspace-scoped REST endpoints from the Planning service.
- [x] Add the initial PostgreSQL schema migration with foreign keys and workspace indexes.
- [x] Run CI, SAST, and security scan; fix all actionable findings.
