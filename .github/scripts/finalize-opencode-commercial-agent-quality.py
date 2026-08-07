"""Apply the remaining deterministic commercial-agent code-quality repair."""

from pathlib import Path


path = Path("packages/commercial-development-agent/src/exhaustive-coverage.test.mjs")
source = path.read_text(encoding="utf-8")
old = "  normalizeCommercialDevelopmentPolicy,\n"
if source.count(old) != 1:
    raise SystemExit("expected exactly one stale normalizeCommercialDevelopmentPolicy import")
path.write_text(source.replace(old, "", 1), encoding="utf-8")
