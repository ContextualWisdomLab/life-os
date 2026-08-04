#!/usr/bin/env python3
"""Convert one PostgreSQL URI into a private libpq connection service file.

The database URI is read only from a named environment variable. The generated
service file lets ``psql`` connect through ``PGSERVICE`` and ``PGSERVICEFILE``
without exposing credentials in process arguments or misusing ``PGDATABASE``.
"""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

SERVICE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
ALLOWED_QUERY_PARAMETERS = {
    "application_name",
    "channel_binding",
    "connect_timeout",
    "gssencmode",
    "hostaddr",
    "krbsrvname",
    "load_balance_hosts",
    "options",
    "require_auth",
    "sslcert",
    "sslcertmode",
    "sslcompression",
    "sslcrl",
    "sslcrldir",
    "sslkey",
    "sslmode",
    "sslpassword",
    "sslrootcert",
    "sslsni",
    "target_session_attrs",
}


class ServiceContractError(ValueError):
    """Indicate that a database URI cannot be represented safely."""


def checked_value(name: str, value: str) -> str:
    """Reject control characters that could alter service-file structure."""

    if not value or any(character in value for character in ("\x00", "\n", "\r")):
        raise ServiceContractError(f"invalid PostgreSQL {name}")
    return value


def parse_database_uri(database_uri: str) -> dict[str, str]:
    """Return explicit libpq parameters parsed from one PostgreSQL URI."""

    try:
        parsed = urlsplit(database_uri)
        port = parsed.port
    except ValueError as error:
        raise ServiceContractError("invalid PostgreSQL URI port") from error

    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ServiceContractError("database URI must use postgres or postgresql")
    if not parsed.hostname:
        raise ServiceContractError("database URI must include a hostname")
    if not parsed.username:
        raise ServiceContractError("database URI must include a username")
    if not parsed.path.startswith("/") or parsed.path == "/":
        raise ServiceContractError("database URI must include a database name")
    if "/" in parsed.path[1:]:
        raise ServiceContractError("database URI database path must be one segment")

    parameters = {
        "host": checked_value("host", parsed.hostname),
        "dbname": checked_value("database name", unquote(parsed.path[1:])),
        "user": checked_value("user", unquote(parsed.username)),
    }
    if port is not None:
        parameters["port"] = str(port)
    if parsed.password is not None:
        parameters["password"] = checked_value(
            "password", unquote(parsed.password)
        )

    seen_query_parameters: set[str] = set()
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key not in ALLOWED_QUERY_PARAMETERS:
            raise ServiceContractError(
                f"unsupported PostgreSQL URI parameter: {key}"
            )
        if key in seen_query_parameters:
            raise ServiceContractError(
                f"duplicate PostgreSQL URI parameter: {key}"
            )
        seen_query_parameters.add(key)
        parameters[key] = checked_value(key, value)
    return parameters


def write_service_file(
    destination: Path, service_name: str, parameters: dict[str, str]
) -> None:
    """Write a mode-0600 libpq service file with deterministic key ordering."""

    if SERVICE_NAME_PATTERN.fullmatch(service_name) is None:
        raise ServiceContractError("invalid PostgreSQL service name")
    if destination.exists():
        raise ServiceContractError("PostgreSQL service file already exists")

    destination.write_text(
        "\n".join(
            [f"[{service_name}]"]
            + [f"{key}={parameters[key]}" for key in sorted(parameters)]
            + [""]
        ),
        encoding="utf-8",
    )
    destination.chmod(0o600)


def parse_arguments() -> argparse.Namespace:
    """Parse non-secret environment-variable and output identifiers."""

    parser = argparse.ArgumentParser()
    parser.add_argument("--environment-variable", required=True)
    parser.add_argument("--service-name", required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    """Create one service file from a URI held in the requested environment variable."""

    arguments = parse_arguments()
    database_uri = os.environ.get(arguments.environment_variable, "")
    if not database_uri:
        print(
            f"service_error={arguments.environment_variable}_required",
            file=os.sys.stderr,
        )
        return 1
    try:
        write_service_file(
            arguments.output,
            arguments.service_name,
            parse_database_uri(database_uri),
        )
    except (OSError, ServiceContractError) as error:
        print(f"service_error={error}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
