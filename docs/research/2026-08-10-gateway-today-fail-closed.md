# Gateway Today composition fail-closed boundary

## Status

**Implemented on active PR**

This record documents the first bounded remediation for issue #163. It does not claim that authenticated Planning/Habit composition is complete.

## Decision

The public `@life-os/gateway` must not return fabricated Today data while real authenticated composition is unavailable. Until the gateway can derive user/workspace authority, mint reviewed short-lived service contexts, call Planning/Habit through bounded service contracts, validate downstream evidence, and surface real product state, `GET /today` fails explicitly with one credential-free Problem Details response.

The transitional response is HTTP 503 with code `today_composition_unavailable`. It contains no synthetic tasks, habits, priorities, review text, tenant identifiers, credentials, downstream URLs, stack traces, or provider details. Issue #163 remains open until real composition replaces this transitional failure.

## Rationale

RFC 9457 defines a standard Problem Details format for HTTP APIs so clients can receive machine-readable failure semantics without bespoke error payloads. LifeOS uses the RFC structure (`type`, `title`, `status`) plus a stable product `code` extension, while keeping the response bounded and non-sensitive.

NIST SP 800-53 Rev. 5 includes least-functionality and fail-safe security/control principles relevant to avoiding functionality that appears successful when its authoritative dependencies are absent. LifeOS applies those principles here by refusing to synthesize successful user data and by separating liveness (`/health`) from product availability (`/today`). This is an architectural rationale, not a claim of formal NIST conformance.

## Required successor

The completed issue #163 path must:

- derive user/workspace authority from the authenticated session or another explicitly trusted host boundary;
- forward no browser credential to Planning or Habit;
- mint the reviewed signed service context for downstream tenant authority;
- bound downstream origins, response bytes, media types, timeouts and JSON shapes;
- preserve service-owned persistence and avoid cross-service table reads;
- distinguish authentication, not-found, dependency-unavailable and intentionally degraded states without invented data; and
- provide realistic integration/browser and operational acceptance evidence.

## APA 7 references

Nottingham, M., Wilde, E., & Dalal, S. (2023). *Problem details for HTTP APIs* (RFC 9457) [Final RFC]. RFC Editor. https://doi.org/10.17487/RFC9457

Joint Task Force. (2020). *Security and privacy controls for information systems and organizations* (NIST Special Publication 800-53 Rev. 5) [Final publication]. National Institute of Standards and Technology. https://doi.org/10.6028/NIST.SP.800-53r5
