# ADR 0005: Plugin Vault hosted runtime ownership

- Status: Proposed
- Date: 2026-09-04
- Owners: Integration bounded context
- Depends on: ADR 0004; PRs #205, #235, #241, #242, #243
- Related buyer gap: #130

## Problem

The authenticated Plugin Vault application composition has no authority to create or own PostgreSQL resources. A hosted Integration process still needs to construct the installation, credential-metadata, and one-time operator-replay adapters from service-owned persistence; register the authenticated operator before its HTTP listener becomes reachable; and release the exact database pool during startup failure or process shutdown.

Leaving those responsibilities to unrelated callers permits three failure classes: separate pools with inconsistent lifecycle ownership, an Integration listener that starts before durable Plugin authority is composed, and acquired PostgreSQL resources that survive failed Vault/operator composition. Borrowing another service's pool or accepting generic `DATABASE_URL` would also weaken the service-owned persistence boundary.

## Constraints

- LifeOS Plugin domain truth and persistence authority remain in the Integration bounded context.
- `INTEGRATION_DATABASE_URL` is the only database configuration name accepted by this runtime seam; generic database aliases and other service settings are not authority.
- Installation lifecycle, credential metadata, and operator replay use the same service-owned SQL pool boundary.
- Vault token/origin/mount and operator verifier configuration remain governed by ADR 0004 and are never persisted or reflected through startup errors.
- The authenticated operator must be registered in the Nest module before `listen` executes.
- Startup failure after resource acquisition must close the acquired runtime.
- Normal shutdown must close the pool exactly once even when multiple shutdown paths converge.
- The current Integration package has no direct `pg` dependency. This ADR therefore does not claim a default production driver or real PostgreSQL/Vault acceptance until that dependency and frozen lockfile are reviewed together.

## Alternatives considered

### A. Let each repository create its own PostgreSQL pool

Rejected. It fragments connection lifecycle, multiplies shutdown authority, and makes one bounded context's transaction/resource policy harder to reason about and operate.

### B. Reuse another LifeOS service's pool or generic `DATABASE_URL`

Rejected. This creates mutable cross-service infrastructure coupling and makes an unrelated service configuration capable of satisfying Plugin persistence authority.

### C. Start the normal Integration module and attach the operator afterward

Rejected. The listener could become reachable while the Plugin routes still have an uncomposed or changing authority boundary. Startup acceptance must be explicit and dependency-complete before listening.

### D. One Integration-owned runtime plus runtime-owning Nest module

Selected. A single pool factory supplies the narrow SQL/end contract. The runtime builds the three Integration-owned PostgreSQL adapters, then the authenticated Vault-backed operator. A wrapper DynamicModule registers that operator and an `OnApplicationShutdown` owner for the same runtime. The bootstrap validates listener configuration before acquisition and calls `listen` only after runtime and module construction succeed.

## Decision

Adopt alternative D as the canonical hosted Plugin composition seam.

`createPluginVaultHostedRuntime` owns one pool boundary and returns one operator plus an idempotent `close()` operation. `createPluginVaultHostedModule` binds that operator to `IntegrationAppModule` and owns runtime shutdown. `startPluginVaultHostedService` validates the listener port, builds the runtime, creates the runtime-owning module, enables Nest shutdown hooks, and only then starts listening. Startup failures attempt Nest cleanup and the same idempotent runtime cleanup before exposing a fixed credential-free error.

The pool factory remains injected in this Proposed slice. A successor must add the concrete Integration-owned PostgreSQL driver/default deployment composition and update `apps/integration-service/package.json` and `pnpm-lock.yaml` atomically; the repository uses frozen-lockfile installation, so a package-only change is not acceptable evidence. Real PostgreSQL plus Vault acceptance is required before this ADR can become Accepted.

## Evidence

- RED `271b5d103502428c953447458f7e692a0af9805b`: exact Integration DB authority, one pool, concurrent exactly-once shutdown, failure cleanup, generic alias rejection.
- Initial implementation `dc75dad0183777e127618d90e92b70c33689c5c8`.
- RED expansion `167667048c5bba32e63e079fa8bd6528722159cd`: malformed environment and malformed acquired pool-like resource.
- Repair `b9590f548aa3f4f3e4005220c1e3bd780eec4ff7`: bounded environment validation and cleanup of acquired closable values.
- Module lifecycle RED `08738a55ab52086728546e7aacd9e490016b7db1`, refined test seam `c2a285b82344a9e5551245a683ffbb7babe9d90f`, implementation `22e74cdb886880c12130fd81e4ca586ad8ae49fe`.
- Bootstrap RED `a88b1bdcea312fc3d85cb0aed6a756c1f6c11ce7` and implementation `9b6b3a7b7568a0f929661f6d2ecf38d0493ad2cb`.
- Edge-contract expansions `0ace60f0bb45c608dc3b88bb5bfd0e3b732adcb0`, `0dad08faab16b4cbe1c789e848b82512ebd237bb`, and `f0b76371c9d19836b1b73493dfd1889ddc70a265` cover malformed environment/database/factory/pool/runtime/application envelopes, pool-factory failure, shutdown failure/reuse, cleanup failure, listener-port bounds, application-construction failure, shutdown-hook failure, listener failure, and nested cleanup failure without widening public error detail.
- Nest documents `onApplicationShutdown` as an application lifecycle hook and requires shutdown hooks to be enabled for signal-driven shutdown. node-postgres documents `pool.end()` as the operation that drains active clients, disconnects clients, and stops pool timers. These primary implementation references support the explicit lifecycle ownership rather than an ad hoc process-exit callback.

## Risks and follow-up

The current seam cannot by itself prove real driver behavior, connection limits, TLS configuration, server failover, migration compatibility, or Vault availability. Those claims remain prohibited until the concrete driver/default deployment composition and real acceptance test exist on protected lineage. Outbound plugin delivery remains a later and separate authority requiring connect-time SSRF/DNS-rebinding controls, redirect/proxy restrictions, request/response limits and deadlines, signing/idempotency, durable attempt/outcome/retry/dead-letter/recovery, revocation fencing, and buyer-visible operator state.

## References

NestJS. (n.d.). *Lifecycle events*. Retrieved September 4, 2026, from https://docs.nestjs.com/fundamentals/lifecycle-events

node-postgres. (n.d.). *Pooling*. Retrieved September 4, 2026, from https://node-postgres.com/features/pooling

node-postgres. (n.d.). *pg.Pool API*. Retrieved September 4, 2026, from https://node-postgres.com/apis/pool
