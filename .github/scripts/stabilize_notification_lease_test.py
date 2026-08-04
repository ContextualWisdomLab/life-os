#!/usr/bin/env python3
"""Make notification lease-recovery evidence independent of wall-clock drift."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "apps/notification-service/src/postgres-reminder-repository.integration.test.ts"
TITLE = "it('recovers an expired lease and completes an exact inbox replay once'"
OLD = "SET claim_expires_at = clock_timestamp() - interval '1 second'"
NEW = "SET claim_expires_at = TIMESTAMPTZ '2000-01-01 00:00:00+00'"

text = PATH.read_text(encoding="utf-8")
if NEW not in text:
    if text.count(TITLE) != 1:
        raise SystemExit('expected one lease-recovery integration test')
    prefix, target = text.split(TITLE, 1)
    if target.count(OLD) < 1:
        raise SystemExit('expected one wall-clock lease fixture in target test')
    target = target.replace(OLD, NEW, 1)
    PATH.write_text((prefix + TITLE + target).rstrip() + "\n", encoding="utf-8")
