# Quick Capture and Planning Search UI Slice

## Goal

Expose the tenant-safe planning search merged in #88 from the Today workspace without allowing a browser to choose its own workspace identity. Keep quick capture explicitly browser-local until a durable authenticated mutation contract is delivered.

## User-visible behavior

- The Today page keeps a fast local capture field for unsynchronized actions.
- The local field states that its data remains in the current browser.
- A separate search field retrieves durable goals, projects, and tasks.
- Search presents explicit loading, empty, unauthenticated, unavailable, and result states.
- Capture and search remain keyboard-operable and usable at a narrow mobile viewport.

## Trust boundary

1. The browser sends only a bounded query to the same-origin web route.
2. The web route forwards the browser session cookie only to identity-service.
3. Identity-service resolves the authenticated session and returns its workspace identifier.
4. The web route signs a short-lived workspace context with a dedicated secret shared only with planning-service.
5. Planning-service verifies the HMAC, age, and workspace UUID before searching.
6. The browser cookie and any browser-provided workspace identifier are never forwarded to planning-service.

The signed message is versioned and canonical:

```text
life-os.workspace.v1\n<lowercase workspace UUID>\n<issued-at Unix seconds>
```

The signature is HMAC-SHA-256 encoded as unpadded Base64url. The secret must contain at least 32 UTF-8 bytes and must be independent from the browser session secret.

## Bounds

- query: 2–120 Unicode code points
- distinct Unicode letter-or-number tokens: 1–8
- result limit: 1–25
- upstream response: at most 16 KiB
- browser cookie header: at most 4 KiB
- upstream timeout: 3 seconds
- result title: at most 160 Unicode code points and 1 KiB

All service origins must be credential-free HTTP(S) origins with no path, query, or fragment. Redirects are rejected. Upstream failures are mapped to bounded credential-free problem responses.

## Validation evidence

- unit tests verify origin, secret, session, HMAC, query, response-size, and entity-shape validation
- BFF tests verify the browser cookie reaches identity-service but never planning-service
- BFF tests verify the exact signed context accepted by planning-service
- Playwright tests verify local capture separation, durable search results, empty/authentication/failure states, keyboard operation, mobile layout, reload persistence, and the three-priority limit
- repository formatting, type checking, tests, build, AppGuardrail, SAST, security scan, commercial-readiness, and review gates must pass on the exact current head

## Deliberate exclusions

This slice does not make browser-local captures durable, add cross-domain search, add server-side result pagination, or add a user-selectable workspace switcher. Those require explicit authenticated authorization and synchronization contracts in later slices of #87.
