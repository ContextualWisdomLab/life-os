# ADR-0006: Work-conserving autonomous maintenance

**Status:** Accepted  
**Date:** 2026-08-09

## Context

LifeOS uses automated commercial-readiness/review/development loops. A naive automation loop can waste an entire invocation describing one queued check, failed mutation path, missing CLI, reviewer delay, or writer conflict even when other safe work exists.

## Drivers

- maximize validated repository/product progress per finite run;
- avoid concurrent branch writers;
- preserve exact-head/base evidence;
- distinguish a blocked action from a blocked repository;
- avoid routine status narration as an output substitute;
- continue buyer-visible development after PR queues drain.

## Alternatives

1. Stop the whole run at the first blocker.
2. Retry one blocker indefinitely.
3. Maintain a live executable queue, localize blockers, preserve a writer lease, and continue non-conflicting work.

## Decision

Autonomous maintenance is work-conserving. Each run refetches live PR/head/base/review/check state, performs evidence-backed RCA, verifies remedy feasibility, executes the highest-value safe action, and immediately selects the next action while run budget remains.

A writer lease prevents races on a branch, but a conflict freezes only that target. Queued checks, provider latency, missing local tools, review delay or a failed first remedy do not by themselves terminate the run or disable the hourly scheduler.

A successful commit, documentation update, PR creation, merge, or check dispatch is an intermediate result rather than automatic completion.

## Consequences

- Runs may combine one coherent source-write root cause with additional read-only/review/merge/cleanup/product-preparation work.
- Operational state must be refetched rather than trusted from memory.
- User-visible notification becomes exceptional and action-oriented.
- Scheduler prompts are updated when a repeated premature-stop pattern is discovered.

## Failure/recovery

If another writer moves the same target, discard stale assumptions, reconcile read-only, and continue elsewhere. If one mutation mechanism is unavailable, probe alternative connector/Git/ref/artifact/workflow paths before declaring user action necessary.

## Security/governance impact

Exact-head/base/blob guards, no fabricated approval/evidence, branch-protection compliance and bounded permissions remain mandatory. Work-conserving execution increases activity, not authority.

## Acceptance evidence

Protected-main `AGENTS.md` waiting/escalation rules and commercial-readiness loop; the enabled external LifeOS hourly maintainer extends this policy. PR #122 adds a repository-local bounded OpenCode development loop but is not protected-main evidence until merged.

## Migration/rollback

Automation may be paused/removed without changing product data. Duplicate writer loops are consolidated rather than stacked. A failed scheduler mechanism falls back to manual/connector-safe maintenance without weakening merge gates.

## Supersession

Supersede only if a different scheduling/concurrency model provides equal or better exact-head safety, throughput, observability and non-conflicting continuation.
