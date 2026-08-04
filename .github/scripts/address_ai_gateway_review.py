#!/usr/bin/env python3
"""Apply the reviewed AI gateway security and formatting repairs idempotently."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    """Replace one exact reviewed fragment or fail closed if the source moved."""
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def main() -> None:
    """Replace credential-shaped fixtures with runtime-generated test key material."""
    generated_key = "Buffer.alloc(32, 7).toString('base64url')"
    replace_once(
        "apps/ai-service/src/no-silent-mutation.integration.test.ts",
        "const GATEWAY_SECRET = 'trusted-ai-gateway-context-secret-32-bytes';",
        f"const GATEWAY_SECRET = {generated_key};",
    )
    replace_once(
        "apps/web/app/ai-proposal-client.test.ts",
        "const GATEWAY_SECRET = 'trusted-ai-gateway-context-secret-32-bytes';",
        f"const GATEWAY_SECRET = {generated_key};",
    )
    replace_once(
        "docs/superpowers/plans/2026-08-04-ai-authenticated-gateway-context.md",
        "const secret = '0123456789abcdef0123456789abcdef';",
        f"const secret = {generated_key};",
    )


if __name__ == "__main__":
    main()
