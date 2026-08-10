# ADR 0006: Work-conserving autonomous maintenance

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context
LifeOS maintenance includes PR review/fixes, CI, documentation, buyer-gap development and release preparation. Treating one waiting PR or one completed action as run completion wastes available execution and lets product gaps persist.

## Decision drivers
Exact-head evidence, safe single-writer behavior, bounded autonomy, auditability, progress during CI/reviewer latency, no gate bypass.

## Alternatives considered
- stop after one useful action — rejected;
- poll one blocked PR until completion — rejected;
- parallel uncontrolled repository writers — rejected;
- one writer with a work-conserving queue and branch-local deferral — selected.

## Decision
The dedicated LifeOS loop repeatedly selects the highest-value safe executable item. Waiting is local to an exact PR/head/run/review identity. Before each write it refetches target head/base/blob/review state. It fixes valid findings test-first, never fabricates approval/check evidence, and merges only unchanged exact heads satisfying live policy. Documentation and prompt changes are intermediate actions.

## Consequences
Runs may perform several non-conflicting actions and require fresh-state discipline. Historical summaries/SHAs cannot be treated as current evidence.

## Failure and recovery
If a branch moves under another writer, freeze that branch for the run and rotate elsewhere. Failed repair mechanisms become RCA evidence for another remedy. Scheduler/control-plane errors do not disable the recurring task unless truly unrecoverable.

## Security and privacy impact
Least privilege and exact identity checks reduce accidental cross-branch or stale-state mutation. Model-assisted development remains separated from merge authority and uses approved NVIDIA/OpenCode boundaries.

## Acceptance evidence
Protected-main `AGENTS.md`, commercial-development automation, buyer-gap/readiness tooling and merge behavior embody the queue/exact-head/no-bypass contract.

## Migration and rollback
Automation prompt/workflow changes preserve a single LifeOS writer lease and hourly cadence. Rollback restores the last reviewed policy without weakening repository gates.

## Supersession
A successor automation ADR must preserve equivalent safety/evidence semantics or explicitly justify each weakened/changed control.