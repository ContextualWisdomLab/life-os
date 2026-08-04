#!/usr/bin/env python3
"""Add beginner-readable JSDoc to every notification production declaration."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_FILES = (
    ROOT / "apps/notification-service/src/notification-runtime.ts",
    ROOT / "apps/notification-service/src/postgres-reminder-repository.ts",
    ROOT / "apps/notification-service/src/reminder-scheduler.ts",
)

TOP_LEVEL_PATTERNS = (
    (re.compile(r"^(?P<indent>\s*)(?:export\s+)?interface\s+(?P<name>[A-Za-z_$][\w$]*)"), "interface"),
    (re.compile(r"^(?P<indent>\s*)(?:export\s+)?type\s+(?P<name>[A-Za-z_$][\w$]*)"), "type"),
    (re.compile(r"^(?P<indent>\s*)(?:export\s+)?class\s+(?P<name>[A-Za-z_$][\w$]*)"), "class"),
    (re.compile(r"^(?P<indent>\s*)(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)"), "function"),
)
METHOD_PATTERN = re.compile(
    r"^(?P<indent>  )(?:(?:public|private|protected|static|readonly|async)\s+)*"
    r"(?P<name>constructor|[A-Za-z_$][\w$]*)(?:<[^>]+>)?\s*\("
)
RESERVED_WORDS = {"if", "for", "while", "switch", "catch", "return", "throw", "super"}

SPECIAL_DESCRIPTIONS = {
    "persistenceFailure": "Raises the stable credential-free persistence error used at every fail-closed boundary.",
    "requireUuid": "Validates and canonicalizes an untrusted UUIDv4 identifier before it reaches SQL.",
    "requireExpectedUuid": "Rejects a returned identifier when it does not match the tenant-scoped value requested by the caller.",
    "requireTimestamp": "Validates an RFC 3339 timestamp or PostgreSQL Date value and returns canonical UTC text.",
    "requireNullableTimestamp": "Validates an optional timestamp while preserving an explicit null value.",
    "requireLocalDate": "Validates a real Gregorian calendar date in YYYY-MM-DD form.",
    "requireNullableLocalDate": "Validates an optional local calendar date while preserving null.",
    "requireInteger": "Validates an integer against an explicit inclusive safety range.",
    "requireLimit": "Validates a caller-supplied result limit against the repository-wide maximum.",
    "safeReminderOccurrence": "Converts untrusted reminder data into the validated scheduler domain shape or fails closed.",
    "hashNotificationIdempotencyKey": "Returns SHA-256 bytes for a bounded opaque key without persisting the raw value.",
    "exactlyOne": "Requires a SQL operation to return exactly one row before any row is trusted.",
    "zeroOrOne": "Requires a conditional SQL operation to return at most one row.",
    "baseReminderFromRow": "Validates the scheduler fields of an untrusted PostgreSQL reminder row.",
    "parsePersistedReminder": "Validates a complete durable reminder row and enforces optional tenant and reminder expectations.",
    "parseOutcome": "Validates an immutable outcome row and its kind-specific invariants.",
    "parseInbox": "Validates an inbox row, tenant ownership, and monotonic delivery/read timestamps.",
    "validateDelivery": "Validates a delivery envelope without retaining its raw idempotency key.",
    "scheduleMatches": "Compares an attempted schedule with its persisted immutable replay fields.",
    "inboxMatches": "Compares an attempted delivery with the persisted inbox replay fields.",
    "requireSuccessfulTransition": "Requires both the reminder state transition and immutable outcome insert to succeed atomically.",
    "requireConfiguration": "Reads one required bounded runtime setting without exposing its value in errors.",
    "requireDatabaseUrl": "Accepts only a syntactically valid PostgreSQL connection URL.",
    "requireBoundedInteger": "Parses one optional integer setting and enforces its documented inclusive range.",
    "defaultPoolFactory": "Creates the production node-postgres pool behind the runtime-owned pool boundary.",
    "createNotificationPoolConfiguration": "Builds bounded node-postgres configuration from validated environment data.",
    "createNotificationRuntime": "Composes one independently deployable notification runtime from a shared validated pool.",
    "isRecord": "Narrows an untrusted value to a non-array object before field validation.",
    "requireTitle": "Validates bounded user-authored reminder text without silently normalizing it.",
    "requireInstant": "Validates and canonicalizes an absolute RFC 3339 reminder instant.",
    "requireTimeZone": "Validates an IANA time-zone identifier through the platform time-zone database.",
    "requireQuietHours": "Validates an optional non-empty local quiet-hours interval.",
    "validateReminderOccurrence": "Validates every field of an untrusted reminder occurrence at the scheduler boundary.",
    "zonedClock": "Projects an absolute instant into a validated local date and minute for one IANA time zone.",
    "isWithinQuietHours": "Tests whether a local minute falls inside a same-day or overnight quiet interval.",
    "nextAllowedInstant": "Finds the first bounded absolute instant allowed by next-day and quiet-hours policy.",
    "retryInstant": "Computes the bounded linear retry instant for the next delivery attempt.",
    "idempotencyKey": "Builds the stable tenant-scoped occurrence key supplied to idempotent delivery adapters.",
    "query": "Executes one parameterized PostgreSQL statement and maps transport failures to a credential-free service error.",
    "end": "Closes the owned node-postgres pool and releases its connections.",
    "schedule": "Persists one validated occurrence or returns an exact idempotent replay.",
    "createOccurrence": "Delegates the explicit occurrence-write name to the canonical schedule operation.",
    "listDue": "Returns a bounded deterministic set of due, unclaimed reminder occurrences.",
    "claim": "Acquires a fenced expiring claim and returns its opaque per-attempt token.",
    "countDelivered": "Counts delivered outcomes for one workspace and one local calendar date.",
    "markDelivered": "Atomically completes a fenced claim and appends its immutable delivered outcome.",
    "defer": "Atomically releases a fenced claim, reschedules the occurrence, and appends a deferral outcome.",
    "fail": "Atomically records either a bounded retry or a terminal attempt-limit failure.",
    "listReminders": "Returns a bounded newest-first durable reminder view for one workspace.",
    "listOccurrences": "Provides the internal-composition alias for the tenant reminder view.",
    "listOutcomes": "Returns a bounded newest-first immutable outcome view for one workspace.",
    "listInbox": "Returns a bounded newest-first in-app inbox view for one workspace.",
    "listInboxMessages": "Provides the internal-composition alias for the tenant inbox view.",
    "deliver": "Inserts one idempotent in-app message or verifies the exact persisted replay.",
    "close": "Closes the runtime-owned PostgreSQL pool exactly once.",
    "onApplicationShutdown": "Delegates the NestJS shutdown lifecycle to the idempotent runtime close operation.",
    "run": "Processes one bounded scheduler iteration with fenced claims and deterministic outcome accounting.",
}


def humanize(name: str) -> str:
    """Convert a TypeScript identifier into lower-case words."""
    words = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name).replace("_", " ")
    return words.lower()


def describe(kind: str, name: str) -> str:
    """Create a precise fallback description for one declaration."""
    if name in SPECIAL_DESCRIPTIONS:
        return SPECIAL_DESCRIPTIONS[name]
    words = humanize(name)
    if name == "constructor":
        return "Creates the component with validated dependencies and bounded configuration."
    if kind == "interface" and name.endswith("Row"):
        return f"Describes the untrusted PostgreSQL {words.removesuffix(' row')} row validated before domain use."
    if kind == "interface":
        return f"Defines the {words} contract used across notification-service boundaries."
    if kind == "type":
        return f"Represents the bounded {words} values used by the notification service."
    if kind == "class":
        return f"Implements {words} behavior behind an explicit notification-service boundary."
    return f"Performs the {words} operation while preserving bounded, tenant-safe notification behavior."


def previous_nonempty(lines: list[str], index: int) -> str:
    """Return the closest preceding non-empty line."""
    for candidate in range(index - 1, -1, -1):
        if lines[candidate].strip():
            return lines[candidate].strip()
    return ""


def declaration(line: str) -> tuple[str, str, str] | None:
    """Classify a source line when it begins a declaration requiring JSDoc."""
    for pattern, kind in TOP_LEVEL_PATTERNS:
        match = pattern.match(line)
        if match and len(match.group("indent")) == 0:
            return match.group("indent"), kind, match.group("name")
    match = METHOD_PATTERN.match(line)
    if match and match.group("name") not in RESERVED_WORDS:
        return match.group("indent"), "method", match.group("name")
    return None


def document_file(path: Path) -> int:
    """Insert missing JSDoc blocks into one production source file."""
    lines = path.read_text(encoding="utf-8").splitlines()
    documented: list[str] = []
    inserted = 0
    for index, line in enumerate(lines):
        found = declaration(line)
        if found is not None and not previous_nonempty(lines, index).endswith("*/"):
            indent, kind, name = found
            documented.append(f"{indent}/** {describe(kind, name)} */")
            inserted += 1
        documented.append(line)
    path.write_text("\n".join(documented) + "\n", encoding="utf-8")
    return inserted


def main() -> None:
    """Document every production declaration and report the deterministic edit count."""
    inserted = sum(document_file(path) for path in SOURCE_FILES)
    if inserted == 0:
        raise SystemExit("No undocumented notification declarations were found")
    print(f"inserted_docstrings={inserted}")


if __name__ == "__main__":
    main()
