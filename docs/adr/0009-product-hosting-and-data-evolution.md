# ADR 0009: Multi-user server-backed product and modular deployment evolution

**Status:** Accepted architecture  
**Date:** 2026-08-10

## Context

The earliest LifeOS exploration considered a private/login-free local-first PWA. The product then moved to Google/GitHub authentication, an owned backend, PostgreSQL durability and a public/self-hostable application. A simple single-Docker direction was also considered before domain-oriented MSA became the durable architecture.

## Decision drivers

- cross-device durability;
- multi-user tenant isolation;
- open-source/self-hostable deployment;
- independently bounded service ownership;
- integration with calendar, AI, privacy, plugins and external CWL services;
- preserve explicit browser-local draft semantics where useful.

## Considered alternatives

1. Browser-only local-first system of record — rejected as the primary architecture because it cannot provide the accepted cross-device/server product contract.
2. Single application/database as durable architecture — rejected for long-term domain ownership, while retained as a deployment simplification idea only.
3. Multi-user server-backed modular MSA with local draft/cache support — selected.

## Decision

LifeOS is a public open-source/self-hostable multi-user product. Google/GitHub authentication, server-side domain services, PostgreSQL durability and Next.js/PWA are current boundaries. Domain services own data and communicate through versioned contracts. Browser-local state remains useful for explicit drafts/offline UX and must not be represented as durable until accepted by the owning service. Compose is a composition/development profile, not the architectural authority model.

## Consequences

- operators own more infrastructure/secrets than a browser-only app;
- privacy/security/backup/migrations become first-class product/operational concerns;
- cross-device durability is possible but requires explicit conflict/reconnect design;
- standalone self-hosting and modular integrations can coexist.

## Failure and recovery

If server dependencies are unavailable, local draft UX may continue only where explicitly implemented, with clear non-durable labeling. Reconnection requires service-owned acceptance/conflict semantics rather than silent overwrite.

## Security and privacy impact

Server-side persistence increases operator responsibility for encryption, access control, retention, backup and incident response. The public repository contains only synthetic examples; real personal data is runtime tenant data, not source content.

## Acceptance evidence

Protected main contains Google/GitHub identity boundaries, PostgreSQL-backed services, Next.js/PWA, Compose/Kubernetes composition and service-owned persistence. PR #127 advances the bounded cross-device Today journey.

## Migration and rollback

The historical local-first/single-app ideas require no production data rollback; they remain design history. Any future offline-first replication authority change requires a new ADR and explicit conflict/data-ownership migration.

## Supersession

This ADR marks local-first-only, private-personal-only and single-application primary architecture descriptions as superseded while preserving local draft and Compose use cases.