# LifeOS

**The open-source personal operating system for goals, projects, tasks, habits, and reviews.**

LifeOS connects everyday action to longer-term direction. It is designed as a multi-user, self-hostable SaaS with domain-oriented microservices, user-owned data, and auditable AI assistance.

## Status

LifeOS is in active foundation development. The current `develop` branch contains the initial monorepo, gateway, service skeletons, shared contracts, responsive web shell, PostgreSQL, and NATS JetStream configuration.

## Architecture

```text
Web / PWA
   |
API Gateway / BFF
   |---------------------------------------------|
Identity       Planning       Habit       Review
   |              |             |           |
PostgreSQL schemas / databases + NATS JetStream events
```

The MVP deliberately keeps goals, projects, milestones, and tasks in one Planning bounded context. Services own their persistence boundaries; direct cross-service table access is prohibited.

## Repository layout

```text
apps/
  web/
  gateway/
  identity-service/
  planning-service/
  habit-service/
  review-service/
packages/
  contracts/
infra/
docs/
```

## Prerequisites

- Node.js 22+
- pnpm 10+
- Docker with Compose

## Local development

```bash
cp .env.example .env
corepack enable
pnpm install
docker compose up -d
pnpm dev
```

Default endpoints:

- Web: `http://localhost:3000`
- Gateway health: `http://localhost:4000/v1/health`
- Gateway Today composition: `http://localhost:4000/v1/today`
- Gateway Prometheus metrics: `http://localhost:4000/v1/metrics`
- Planning-service health: `http://localhost:4102/v1/health`
- Planning-service Prometheus metrics: `http://localhost:4102/v1/metrics`
- NATS monitoring: `http://localhost:8222`

Metrics endpoints contain operational data. Production ingress must restrict them to the monitoring network.

## Authentication

Google and GitHub OAuth are the required login providers. Provider credentials are supplied through environment variables and must never be committed. OAuth flows are part of the next implementation slice; the current web actions are interface placeholders.

## Privacy

This is a public repository. It contains synthetic examples only. Personal goals, health information, relationship data, credentials, access tokens, and production exports must not be committed.

## Documentation

- Product and architecture design: `docs/superpowers/specs/2026-08-02-life-os-design.md`
- Foundation implementation plan: `docs/superpowers/plans/2026-08-02-life-os-foundation.md`
- Gateway service-level objectives: `docs/operations/service-level-objectives.md`
- Planning-service service-level objectives: `docs/operations/planning-service-level-objectives.md`

## Contributing

Development work targets `develop` and reaches `main` through reviewed pull requests. Keep service boundaries explicit, update contracts before consumers, add tests with behavior changes, and avoid introducing infrastructure that has no measured need.

## License

A project license will be selected before the first public release. Until then, the source is publicly visible but no license grant is implied.
