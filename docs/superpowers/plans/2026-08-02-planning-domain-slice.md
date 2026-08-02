# Planning Domain Slice

**Goal:** Implement the first usable Planning bounded-context slice with tenant-safe Goal → Project → Task behavior and a PostgreSQL migration.

## Tasks

- [ ] Define domain types and validation rules for Goal, Project, and Task.
- [ ] Implement a workspace-scoped repository contract and in-memory reference implementation.
- [ ] Prove tenant isolation and parent-child ownership with tests.
- [ ] Expose workspace-scoped REST endpoints from the Planning service.
- [ ] Add the initial PostgreSQL schema migration with foreign keys and workspace indexes.
- [ ] Run CI, SAST, security scan, and review feedback; fix all actionable findings.
