# LifeOS

**The open-source personal operating system for goals, projects, tasks, habits, and reviews.**

LifeOS connects everyday action to longer-term direction. It is designed as a multi-user, self-hostable SaaS with domain-oriented microservices, user-owned data, and auditable AI assistance.

## Status

LifeOS is in active foundation development. The current `main` branch contains the monorepo, gateway, bounded services, shared contracts, responsive web shell, PostgreSQL persistence, NATS JetStream configuration, security gates, and commercial-readiness evidence loop. Interfaces and migrations may still change before the first stable release.

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

Google and GitHub OAuth are the required login providers. Provider credentials are supplied through environment variables and must never be committed. Deployment operators are responsible for provider registration, redirect URI policy, secret rotation, and production access controls.

## Privacy and deployment responsibility

This is a public repository. It contains synthetic examples only. Personal goals, health information, relationship data, credentials, access tokens, private prompts, customer data, and production exports must not be committed.

The upstream project does not operate every LifeOS deployment. A self-hosting organization controls its deployment data and must establish its own privacy notice, retention policy, security controls, subprocessors, and legal basis. See the [upstream privacy notice](docs/legal/privacy.md) and [upstream project terms](docs/legal/terms.md) for the upstream project boundary.

## Documentation

- Product and architecture design: `docs/superpowers/specs/2026-08-02-life-os-design.md`
- Foundation implementation plan: `docs/superpowers/plans/2026-08-02-life-os-foundation.md`
- Gateway service-level objectives: `docs/operations/service-level-objectives.md`
- Planning-service service-level objectives: `docs/operations/planning-service-level-objectives.md`
- [Upstream privacy notice](docs/legal/privacy.md)
- [Upstream project terms](docs/legal/terms.md)
- [Vulnerability reporting](SECURITY.md)

## Contributing

Create descriptive branches from the current `main` branch and submit reviewed pull requests back to `main`. Keep service boundaries explicit, update contracts before consumers, add tests with behavior changes, and avoid infrastructure without a measured need.

Contributions are accepted under the Apache License 2.0 using the inbound-equals-outbound model described in [CONTRIBUTING.md](CONTRIBUTING.md). Do not disclose unpatched vulnerabilities or sensitive evidence in public issues; use [SECURITY.md](SECURITY.md).

## License

LifeOS is licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The license does not grant trademark rights beyond reasonable attribution and identification of origin.
