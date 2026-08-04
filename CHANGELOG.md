# Changelog

All notable changes to LifeOS are documented in this file.

## Unreleased

### Added

- Tenant-safe durable planning search across goals, projects, and tasks, with Unicode-normalized exact, prefix, and whole-token matching.
- An authenticated same-origin planning-search boundary that signs the session-derived workspace context and forwards no browser credential to planning-service.
- An accessible quick-capture and search surface that keeps browser-local Today drafts visibly separate from durable workspace records.

### Fixed

- Planning search now normalizes browser query text and prevents stale or unmounted requests from replacing the latest visible result state.

### Security

- Planning-search upstream responses are stopped at a fixed byte limit before they can be fully buffered by the web boundary.
