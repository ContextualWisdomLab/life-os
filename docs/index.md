---
title: LifeOS
---

# LifeOS

LifeOS is an open-source personal operating system for connecting goals, projects, tasks, habits, and reviews in a self-hostable, user-owned workspace with auditable AI assistance.

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ContextualWisdomLab/life-os)

## Current status

LifeOS is in active foundation development. Protected `main` contains the monorepo, gateway, bounded services, shared contracts, responsive web shell, PostgreSQL persistence, NATS JetStream configuration, security gates, and commercial-readiness evidence loop. Interfaces and migrations may still change before the first stable release.

## Product responsibility

LifeOS owns the personal-workflow domain that connects longer-term direction to everyday action. The MVP keeps goals, projects, milestones, and tasks in one Planning bounded context while Habit and Review remain separate service boundaries. Services own their persistence; direct cross-service table access is prohibited. Optional provider and AI integrations must remain auditable and subordinate to user-owned data and explicit service contracts.

## Documentation

- [README](https://github.com/ContextualWisdomLab/life-os#readme) — product overview, architecture, local development, security and deployment boundaries.
- [Product and technical gap baseline](https://github.com/ContextualWisdomLab/life-os/blob/main/docs/product-technical-gap-baseline.md) — current protected implementation, buyer-visible gaps, and release evidence when integrated.
- [Product and architecture design](https://github.com/ContextualWisdomLab/life-os/blob/main/docs/superpowers/specs/2026-08-02-life-os-design.md) — intended product and bounded-context design.
- [Operations](https://github.com/ContextualWisdomLab/life-os/tree/main/docs/operations) — service objectives, backup/recovery, and deployment guidance.
- [Privacy notice](https://github.com/ContextualWisdomLab/life-os/blob/main/docs/legal/privacy.md) and [project terms](https://github.com/ContextualWisdomLab/life-os/blob/main/docs/legal/terms.md) — upstream project legal boundary.
- [Security policy](https://github.com/ContextualWisdomLab/life-os/blob/main/SECURITY.md) — vulnerability reporting and security expectations.
- [Releases](https://github.com/ContextualWisdomLab/life-os/releases) — immutable release evidence when published.
- [Ask DeepWiki](https://deepwiki.com/ContextualWisdomLab/life-os) — repository-grounded navigation and questions.

## Release and evidence boundary

A source branch, local endpoint, passing test, capability record, open pull request, or reference deployment manifest is not by itself a stable release, production deployment, customer adoption, certification, or evidence that the complete LifeOS journey is commercially ready. Repository-facing claims should remain bound to protected source and applicable immutable release, deployment, recovery, and buyer-journey evidence.

This file is a GitHub Pages source prerequisite. Its presence does not mean GitHub Pages is published; publication is complete only after repository settings are reconciled, deployment succeeds, and the live HTTPS site is verified.
