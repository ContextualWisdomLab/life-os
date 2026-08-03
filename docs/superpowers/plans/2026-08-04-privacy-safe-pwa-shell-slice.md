# Privacy-safe PWA shell slice

## Goal

Make LifeOS installable and resilient to a lost connection without placing personalized planning data, authenticated responses, or API payloads into the service-worker cache.

## Scope

- publish a stable application manifest with standalone display metadata and a first-party mask-safe icon
- register a same-origin service worker from the root layout without blocking rendering
- pre-cache only the public offline fallback, manifest, and icon
- use network-first handling for navigations and return the credential-free offline page only when the network fails
- ignore mutation requests, cross-origin traffic, API responses, and all non-allowlisted application resources
- remove superseded LifeOS shell caches on activation
- prove manifest metadata, service-worker registration, bounded cache contents, and offline fallback behavior in Playwright desktop and mobile projects

## Privacy and trust boundary

The shell cache must never contain the Today page, onboarding page, authenticated HTML, workspace identifiers, API responses, local-storage values, or user-authored content. Browser-local Today state remains owned by the existing versioned local-storage contract and is not read by the service worker.

## Failure behavior

Unsupported or failed registration leaves the online application usable. A failed network navigation returns the cached public fallback when available; it never synthesizes or exposes user data. Service-worker updates do not delete unrelated origin caches.

## Deferred work

Push notifications, background synchronization, offline mutation queues, install-prompt analytics, platform-specific screenshots, durable cross-device state, and authenticated offline access require separate reviewed capabilities.

## Validation

Formatting, lint, type checking, unit tests, production build, Playwright PWA evidence, Compose validation, AppGuardrail, Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all human/security feedback must pass on the exact pull-request head before merge.

Refs #81 and #21.
