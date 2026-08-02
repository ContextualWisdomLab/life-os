# LifeOS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a runnable MSA foundation with a Next.js web app, NestJS gateway and domain services, shared contracts, PostgreSQL, NATS JetStream, Docker Compose, and CI.

**Architecture:** A pnpm/Turborepo monorepo contains independently deployable services. The gateway is the only public API entry point. Each domain service owns its schema boundary and communicates asynchronously through versioned NATS events.

**Tech Stack:** TypeScript, pnpm, Turborepo, Next.js, NestJS, PostgreSQL, NATS JetStream, Vitest, Docker Compose, GitHub Actions.

## Global Constraints

- Public repository; no personal todo data or secrets.
- Google and GitHub OAuth are the required login providers.
- Service boundaries follow domains, not individual entities.
- External synchronous contracts use REST/OpenAPI.
- Asynchronous contracts use versioned JSON Schema.
- All persisted timestamps are UTC; user timezone is an IANA timezone.
- AI features remain advisory and cannot silently mutate user data.

---

### Task 1: Monorepo foundation

**Files:** root package/config files, shared TypeScript config, README, environment example.

- [ ] Create pnpm workspace and Turborepo configuration.
- [ ] Add root scripts for build, test, lint, typecheck, and development.
- [ ] Document local prerequisites and repository layout.
- [ ] Commit the runnable workspace foundation.

### Task 2: Shared contracts

**Files:** `packages/contracts`, `packages/event-schemas`, `packages/config`.

- [ ] Define problem-details API errors and identity/workspace request context.
- [ ] Define versioned domain-event envelope and task-completed schema.
- [ ] Add unit tests for contract validation.
- [ ] Commit shared contracts.

### Task 3: Gateway and service skeletons

**Files:** `apps/gateway`, `apps/identity-service`, `apps/planning-service`, `apps/habit-service`, `apps/review-service`.

- [ ] Add health/readiness endpoints to every service.
- [ ] Add gateway `/v1/health` and `/v1/today` composition placeholder.
- [ ] Add structured configuration loading.
- [ ] Add smoke tests for each application.
- [ ] Commit service skeletons.

### Task 4: Web application foundation

**Files:** `apps/web`.

- [ ] Create responsive Next.js shell.
- [ ] Add Today, Goals, Projects, Tasks, Habits, and Review navigation.
- [ ] Add Google and GitHub login entry points as disabled configuration-aware actions.
- [ ] Add accessibility smoke test and production build.
- [ ] Commit the web foundation.

### Task 5: Local infrastructure

**Files:** `infra/compose`, root `compose.yaml`, Dockerfiles.

- [ ] Add PostgreSQL and NATS JetStream.
- [ ] Add application containers and health checks.
- [ ] Add `.env.example` with non-secret placeholders.
- [ ] Verify `docker compose config` succeeds.
- [ ] Commit local infrastructure.

### Task 6: CI and repository quality

**Files:** `.github/workflows/ci.yml`, lint/format configs.

- [ ] Run install with frozen lockfile.
- [ ] Run formatting, lint, typecheck, tests, and builds.
- [ ] Validate Docker Compose configuration.
- [ ] Add dependency review and secret-safety guidance.
- [ ] Commit CI.

### Task 7: Review and pull request

- [ ] Verify repository files contain no personal data or credentials.
- [ ] Review the develop-to-main diff.
- [ ] Open a draft pull request describing architecture, validation, and follow-up work.
