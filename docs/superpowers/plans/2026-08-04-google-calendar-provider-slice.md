# Google Calendar provider slice

## Outcome

LifeOS can synchronize one validated time block to Google Calendar without duplicate event creation or silent overwrite, while preserving the existing non-destructive calendar provider boundary.

## Standards and primary references

- Google Calendar API Events resource and method contract: <https://developers.google.com/workspace/calendar/api/v3/reference/events>
- Google Calendar event creation and caller-supplied event identifiers: <https://developers.google.com/workspace/calendar/api/guides/create-events>
- Google Calendar conditional resource modification with ETags: <https://developers.google.com/calendar/api/guides/version-resources>
- Google Calendar Events update semantics: <https://developers.google.com/workspace/calendar/api/v3/reference/events/update>

The adapter uses a caller-generated event identifier because Google documents that this prevents duplicate creation when a request succeeds remotely but the client loses the response. Updates use the previously returned strong ETag in `If-Match`; Google returns HTTP 412 when the event changed concurrently.

## Included capability

- add a Google Calendar REST adapter behind the existing `CalendarProvider` write-only contract
- derive a deterministic Google-compatible event identifier from the tenant-scoped LifeOS resource name
- use `events.insert` semantics for creation and full `events.update` semantics for updates
- set `sendUpdates=none` so this bounded time-block slice never sends attendee email notifications
- attach private LifeOS workspace, block, and version metadata to the event
- require the current strong provider ETag before any update
- map duplicate creation and stale ETags to the existing bounded conflict response
- use only the fixed `www.googleapis.com` API origin, disable redirects, bound request time, and bound JSON response size
- reject malformed event contracts, provider identity mismatches, weak ETags, unsafe calendar identifiers, and secret-shaped configuration with whitespace
- allow explicit `google` or `caldav` production provider selection through environment configuration
- add deterministic tests for create identity, update preconditions, conflict mapping, response bounds, configuration validation, and credential-free failures

## Capability boundary

This slice does not store or refresh OAuth credentials, discover calendars, select a calendar through a user interface, ingest provider-side changes, delete or move events, send attendee invitations, retry writes asynchronously, or reconcile uncertain outcomes. The runtime access token is supplied by the operator and is unsuitable as the final multi-user credential architecture.

A subsequent slice must introduce encrypted per-user authorization storage, refresh-token rotation and revocation, authenticated workspace-to-user derivation, calendar discovery and selection, durable synchronization receipts, retry/reconciliation, and operator-visible expiry failures.

## Security controls

- The API base URL is fixed in code; request input cannot select a host or path prefix.
- Calendar identifiers are bounded and path separators, fragments, and query delimiters are rejected before URL encoding.
- Access tokens are bounded, reject whitespace and control characters, and never appear in returned errors.
- Google responses are streamed into a fixed maximum byte budget before JSON parsing.
- The returned event identifier must equal the deterministic LifeOS identifier.
- Returned ETags must be strong quoted validators.
- The adapter accepts only the exact deterministic VEVENT shape produced by the LifeOS calendar domain.
- No delete, move, copy, attendee, or arbitrary provider operation exists in the provider interface.

## Validation gate

Merge only when formatting, lint, type checking, tests, build, AppGuardrail, SAST Semgrep, Security Scan, Commercial Readiness, CodeRabbit, and all human and security review feedback pass on the exact current head with no unresolved actionable finding.

## Rollback

The change is additive. Roll back by selecting the existing `caldav` provider or reverting the adapter commit. Google events already created by this slice are intentionally not deleted automatically; their deterministic private metadata allows later reconciliation without destructive rollback behavior.

Refs #50, #51, and #21.
