#!/usr/bin/env python3
"""Apply incremental reviewed fixes to generated AI coverage evidence."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "apps/ai-service/src/quality-coverage.test.ts"

text = PATH.read_text(encoding="utf-8")
text = text.replace(
    "type SqlResponse = readonly unknown[] | ErrorResponse;",
    "type SqlResponse = unknown[] | ErrorResponse;",
)
text = text.replace(
    """        ...decisionEvent(),
        reason: undefined,
        decidedAt: new Date('2026-08-04T00:00:02.000Z') as unknown as string,
""",
    """        ...decisionEvent(),
        decidedAt: new Date('2026-08-04T00:00:02.000Z') as unknown as string,
""",
)
PATH.write_text(text.rstrip() + "\n", encoding="utf-8")
