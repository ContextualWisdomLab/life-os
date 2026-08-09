# ADR 0006: Work-conserving autonomous maintenance

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

LifeOS uses an hourly autonomous maintenance loop. Earlier runs could stop after one merge, one blocker, one queued check, one documentation update or one failed tool path even when unrelated safe work remained. That behavior wastes the finite invocation and turns the hourly recurrence into an excuse for early termination.

## Decision drivers

- maximize safe validated progress per invocation;
- prevent CI/review/provider latency from blocking unrelated work;
- avoid stale-head decisions and writer races;
- preserve auditable repository protections;
- keep product gaps flowing into implementation rather than reports.

## Considered alternatives

1. One action per hourly run — rejected as underutilizing the invocation.
2. Wait/poll until a selected PR is unblocked — rejected because latency is local to that lane.
3. Work-conserving queue with exact-head evidence, branch-local writer lease and final sweeps — selected.

## Decision

The autonomous loop refetches live repository state, maintains a prioritized executable queue, treats waiting/blockers as local to the affected lane and continues with non-conflicting work. Before writes it refetches target head/live base/blob/ref and avoids racing another source writer. Merge decisions require exact unchanged head and actual repository gates. Documentation, RCA, issue creation, PR creation or one successful commit are intermediate outcomes while safe work remains.

The scheduler prompt is operational control, not the long-term architecture source of truth; detailed durable decisions belong in repository docs/ADRs. Prompt changes replace obsolete clauses instead of accumulating unlimited historical text.

## Consequences

- runs perform more useful work without bypassing protection;
- the loop needs explicit prioritization and defer identities;
- read-only/product-preparation work continues while write lanes wait;
- routine progress narration is minimized.

## Failure and recovery

If one connector/tool/credential/path fails, the loop records that evidence and tries a materially distinct safe route or another lane. A scheduler/run failure does not disable the recurring task. Next runs refetch all state rather than trusting the failed run's assumptions.

## Security and privacy impact

Work conservation never authorizes bypass, fabricated review/checks, force-push, destructive race or secret disclosure. The writer lease limits concurrent source mutation and external repositories with dedicated loops remain read-only dependencies.

## Acceptance evidence

The enabled LifeOS hourly scheduler contains explicit fresh-state, work-conserving queue, writer lease, exact-head merge, docs correctness and double-exit-sweep contracts.

## Migration and rollback

Prompt revisions are reversible through scheduler configuration, while repository governance rules remain documented here/`AGENTS.md`/`ARCHITECTURE.md`. If a prompt version causes scheduler-control failure, reduce/restructure it without disabling the recurring task.

## Supersession

A later ADR may change scheduling/lease strategy only if it preserves repository protections and demonstrates equal or better safe throughput.