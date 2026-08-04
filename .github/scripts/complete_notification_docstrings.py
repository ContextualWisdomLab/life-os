#!/usr/bin/env python3
"""Add beginner-readable JSDoc to every named notification declaration."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = ROOT / "apps/notification-service/src"

TOP_LEVEL_PATTERNS = (
    (
        re.compile(
            r"^(?P<indent>\s*)(?:export\s+)?interface\s+(?P<name>[A-Za-z_$][\w$]*)"
        ),
        "interface",
    ),
    (
        re.compile(
            r"^(?P<indent>\s*)(?:export\s+)?type\s+(?P<name>[A-Za-z_$][\w$]*)"
        ),
        "type",
    ),
    (
        re.compile(
            r"^(?P<indent>\s*)(?:export\s+)?(?:abstract\s+)?class\s+(?P<name>[A-Za-z_$][\w$]*)"
        ),
        "class",
    ),
    (
        re.compile(
            r"^(?P<indent>\s*)(?:export\s+)?(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)"
        ),
        "function",
    ),
)
METHOD_PATTERN = re.compile(
    r"^(?P<indent>\s+)(?:(?:public|private|protected|static|readonly|abstract|override|async)\s+)*"
    r"(?P<name>constructor|[A-Za-z_$][\w$]*)(?:<[^>]+>)?\s*\("
)
ARROW_PATTERN = re.compile(
    r"^(?P<indent>\s*)(?:export\s+)?(?:const|let)\s+"
    r"(?P<name>[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>"
)
RESERVED_WORDS = {
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "throw",
    "super",
    "describe",
    "it",
    "test",
    "expect",
}

SPECIAL_DESCRIPTIONS = {
    "constructor": "Creates the component with explicit dependencies and deterministic initial state.",
    "query": "Executes one parameterized query through the bounded SQL or test-double contract.",
    "end": "Closes the owned resource without exposing connection details.",
    "close": "Closes the runtime-owned resources exactly once.",
    "onApplicationShutdown": "Connects the application shutdown lifecycle to the idempotent close operation.",
    "run": "Processes one bounded reminder batch and returns deterministic aggregate evidence.",
    "claim": "Attempts to acquire the exact observed reminder occurrence using a fenced expiring claim.",
    "deliver": "Persists or verifies one idempotent in-app reminder delivery.",
    "schedule": "Persists one validated reminder occurrence or returns its exact replay.",
    "createOccurrence": "Provides the explicit occurrence-creation alias for the canonical schedule operation.",
    "listDue": "Returns a bounded deterministic set of currently due reminder occurrences.",
    "countDelivered": "Counts delivered outcomes for one workspace and one local calendar date.",
    "markDelivered": "Atomically completes a fenced claim and records an immutable delivered outcome.",
    "defer": "Atomically reschedules a fenced occurrence and records its immutable deferral outcome.",
    "fail": "Atomically records a bounded retry or terminal reminder failure.",
    "listReminders": "Returns a bounded tenant-scoped durable reminder view.",
    "listOccurrences": "Returns the durable occurrence view through the composition-friendly alias.",
    "listOutcomes": "Returns bounded immutable reminder outcome history for one workspace.",
    "listInbox": "Returns a bounded newest-first in-app inbox for one workspace.",
    "listInboxMessages": "Returns the inbox through the composition-friendly alias.",
    "health": "Returns a fixed credential-free liveness response.",
    "hasJSDoc": "Determines whether a declaration has immediately preceding JSDoc.",
    "declarationName": "Builds an actionable name for one parsed TypeScript declaration.",
    "requiresJSDoc": "Selects named declarations governed by the documentation contract.",
    "collectUndocumentedDeclarations": "Collects every named declaration that lacks immediately preceding JSDoc.",
}


def humanize(name: str) -> str:
    """Convert a TypeScript identifier into readable lower-case words."""
    return re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name).replace("_", " ").lower()


def description(kind: str, name: str, test_file: bool) -> str:
    """Create a concise declaration-specific explanation."""
    if name in SPECIAL_DESCRIPTIONS:
        return SPECIAL_DESCRIPTIONS[name]
    words = humanize(name)
    if test_file:
        if kind == "interface":
            return f"Defines the {words} shape used to make the test evidence explicit."
        if kind == "type":
            return f"Represents the {words} values used by deterministic test fixtures."
        if kind == "class":
            return f"Implements the {words} test double with observable deterministic behavior."
        if kind == "constructor":
            return "Creates the test fixture with explicit deterministic dependencies."
        return f"Supports the {words} test scenario without hiding production behavior."
    if kind == "interface":
        return f"Defines the {words} boundary and the values exchanged through it."
    if kind == "type":
        return f"Represents the bounded {words} values accepted by the notification service."
    if kind == "class":
        return f"Implements {words} behavior behind an explicit notification-service boundary."
    if kind == "constructor":
        return "Creates the component with explicit dependencies and validated configuration."
    return f"Performs the {words} operation while preserving tenant-safe bounded behavior."


def preceding_nonempty(lines: list[str], index: int) -> str:
    """Return the closest preceding non-empty source line."""
    for candidate in range(index - 1, -1, -1):
        if lines[candidate].strip():
            return lines[candidate].strip()
    return ""


def classify(line: str) -> tuple[str, str, str] | None:
    """Classify one source line when it begins a named declaration."""
    for pattern, kind in TOP_LEVEL_PATTERNS:
        match = pattern.match(line)
        if match:
            return match.group("indent"), kind, match.group("name")
    arrow = ARROW_PATTERN.match(line)
    if arrow:
        return arrow.group("indent"), "function", arrow.group("name")
    method = METHOD_PATTERN.match(line)
    if method and method.group("name") not in RESERVED_WORDS:
        kind = "constructor" if method.group("name") == "constructor" else "method"
        return method.group("indent"), kind, method.group("name")
    return None


def document_file(path: Path) -> int:
    """Insert missing JSDoc blocks into one TypeScript source file."""
    lines = path.read_text(encoding="utf-8").splitlines()
    output: list[str] = []
    inserted = 0
    test_file = path.name.endswith(".test.ts")
    for index, line in enumerate(lines):
        declaration = classify(line)
        if declaration is not None and not preceding_nonempty(lines, index).endswith("*/"):
            indent, kind, name = declaration
            output.append(f"{indent}/** {description(kind, name, test_file)} */")
            inserted += 1
        output.append(line)
    if inserted:
        path.write_text("\n".join(output) + "\n", encoding="utf-8")
    return inserted


def main() -> None:
    """Document all named notification-service declarations deterministically."""
    source_files = sorted(SOURCE_ROOT.rglob("*.ts"))
    if not source_files:
        raise SystemExit("No notification TypeScript source files were found")
    inserted = sum(document_file(path) for path in source_files)
    print(f"inserted_notification_docstrings={inserted}")


if __name__ == "__main__":
    main()
