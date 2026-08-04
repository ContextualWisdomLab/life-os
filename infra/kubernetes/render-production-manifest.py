#!/usr/bin/env python3
"""Render the reviewed production Kustomize overlay from validated inputs.

The renderer is the single implementation used by both deployment validation
and deployment execution. It copies the reviewed Kubernetes tree into an
isolated directory, replaces each non-deployable sentinel exactly once, invokes
``kubectl kustomize``, and refuses to emit a manifest containing a sentinel.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

ZERO_DIGEST = "0" * 64
WEB_IMAGE_SENTINEL = (
    "ghcr.io/contextualwisdomlab/life-os-web@sha256:" + ZERO_DIGEST
)
GATEWAY_IMAGE_SENTINEL = (
    "ghcr.io/contextualwisdomlab/life-os-gateway@sha256:" + ZERO_DIGEST
)
WEB_ORIGIN_SENTINEL = "https://life-os.invalid"
APPROVED_IMAGE_PATTERNS = {
    WEB_IMAGE_SENTINEL: re.compile(
        r"^ghcr\.io/contextualwisdomlab/life-os-web@sha256:[0-9a-f]{64}$"
    ),
    GATEWAY_IMAGE_SENTINEL: re.compile(
        r"^ghcr\.io/contextualwisdomlab/life-os-gateway@sha256:[0-9a-f]{64}$"
    ),
}


class RenderContractError(ValueError):
    """Indicate that an input or reviewed manifest violates the render contract."""


def approved_image(sentinel: str, image: str) -> str:
    """Return an approved immutable image or raise a contract error."""

    pattern = APPROVED_IMAGE_PATTERNS[sentinel]
    if pattern.fullmatch(image) is None:
        raise RenderContractError(
            "image reference must use the approved LifeOS GHCR path and sha256 digest"
        )
    if image.endswith("sha256:" + ZERO_DIGEST):
        raise RenderContractError("zero image digest is not deployable")
    return image


def exact_https_origin(origin_value: str) -> str:
    """Return a credential-free exact HTTPS origin or raise a contract error."""

    try:
        origin = urlsplit(origin_value)
        _ = origin.port
    except ValueError as error:
        raise RenderContractError("web_origin contains an invalid port") from error

    if (
        origin.scheme != "https"
        or not origin.hostname
        or origin.username is not None
        or origin.password is not None
        or origin.query
        or origin.fragment
        or origin.path not in ("", "/")
    ):
        raise RenderContractError(
            "web_origin must be an exact credential-free HTTPS origin"
        )
    return origin_value


def replace_once(document: str, sentinel: str, replacement: str) -> str:
    """Replace one reviewed sentinel and reject missing or duplicated values."""

    if document.count(sentinel) != 1:
        raise RenderContractError(
            "deployment sentinel is missing or duplicated: " + sentinel
        )
    return document.replace(sentinel, replacement)


def render_manifest(
    source_root: Path,
    render_root: Path,
    output_path: Path,
    web_image: str,
    gateway_image: str,
    web_origin: str,
    kubectl_binary: str,
) -> None:
    """Render a production manifest from validated immutable inputs."""

    if render_root.exists():
        raise RenderContractError("render root already exists")
    if not source_root.is_dir():
        raise RenderContractError("Kubernetes source root does not exist")

    images = {
        WEB_IMAGE_SENTINEL: approved_image(WEB_IMAGE_SENTINEL, web_image),
        GATEWAY_IMAGE_SENTINEL: approved_image(
            GATEWAY_IMAGE_SENTINEL, gateway_image
        ),
    }
    approved_origin = exact_https_origin(web_origin)

    shutil.copytree(source_root, render_root)
    workload_path = render_root / "base" / "edge-workloads.yaml"
    workload_document = workload_path.read_text(encoding="utf-8")
    for sentinel, image in images.items():
        workload_document = replace_once(workload_document, sentinel, image)
    workload_document = replace_once(
        workload_document, WEB_ORIGIN_SENTINEL, approved_origin
    )
    workload_path.write_text(workload_document, encoding="utf-8")

    completed = subprocess.run(
        [
            kubectl_binary,
            "kustomize",
            str(render_root / "overlays" / "production"),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    rendered = completed.stdout
    if ZERO_DIGEST in rendered or WEB_ORIGIN_SENTINEL in rendered:
        raise RenderContractError("rendered manifest contains an unresolved sentinel")
    output_path.write_text(rendered, encoding="utf-8")


def parse_arguments() -> argparse.Namespace:
    """Parse non-secret filesystem and executable arguments."""

    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--render-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--kubectl", default="kubectl")
    return parser.parse_args()


def main() -> int:
    """Render using workflow inputs supplied through the process environment."""

    arguments = parse_arguments()
    try:
        render_manifest(
            source_root=arguments.source_root,
            render_root=arguments.render_root,
            output_path=arguments.output,
            web_image=os.environ.get("WEB_IMAGE", ""),
            gateway_image=os.environ.get("GATEWAY_IMAGE", ""),
            web_origin=os.environ.get("WEB_ORIGIN", ""),
            kubectl_binary=arguments.kubectl,
        )
    except (OSError, RenderContractError, subprocess.CalledProcessError) as error:
        print(f"render_error={error}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
