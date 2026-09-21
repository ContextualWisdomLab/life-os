#!/usr/bin/env bash
set -Eeuo pipefail

: "${LEGACY_POSTGRES_PASSWORD:?Set LEGACY_POSTGRES_PASSWORD to the password currently stored by the legacy local volume}"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD to a new local administrator password}"
: "${NOTIFICATION_RUNTIME_DATABASE_PASSWORD:?Set NOTIFICATION_RUNTIME_DATABASE_PASSWORD to a distinct runtime password}"

if [[ "$POSTGRES_PASSWORD" == 'lifeos' ]]; then
  echo "POSTGRES_PASSWORD must not remain 'lifeos'" >&2
  exit 1
fi
if [[ "$LEGACY_POSTGRES_PASSWORD" == "$POSTGRES_PASSWORD" ]]; then
  echo 'upgrade_error=new_postgres_password_must_differ_from_legacy' >&2
  exit 1
fi
if [[ "$NOTIFICATION_RUNTIME_DATABASE_PASSWORD" == "$POSTGRES_PASSWORD" ]]; then
  echo 'upgrade_error=runtime_password_must_differ_from_admin' >&2
  exit 1
fi

# Compose resolves `.env` interpolation even when those names are not exported to
# this shell. Read the effective database identity from the same rendered model so
# rotation cannot silently target a different database than the existing volume.
EFFECTIVE_POSTGRES_SETTINGS="$(
  POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  NOTIFICATION_RUNTIME_DATABASE_PASSWORD="$NOTIFICATION_RUNTIME_DATABASE_PASSWORD" \
    docker compose config --format json | node --input-type=module -e '
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      const config = JSON.parse(input);
      const environment = config?.services?.postgres?.environment;
      const user = environment?.POSTGRES_USER;
      const database = environment?.POSTGRES_DB;
      const invalid = (value) =>
        typeof value !== "string" || value.length === 0 || /[\t\r\n\0]/u.test(value);
      if (invalid(user) || invalid(database)) process.exit(64);
      process.stdout.write(`${user}\t${database}`);
    '
)"
IFS=$'\t' read -r EFFECTIVE_POSTGRES_USER EFFECTIVE_POSTGRES_DB <<< "$EFFECTIVE_POSTGRES_SETTINGS"
if [[ "$EFFECTIVE_POSTGRES_USER" != 'lifeos' ]]; then
  echo 'upgrade_error=legacy_postgres_user_must_be_lifeos' >&2
  exit 1
fi

# An existing data directory ignores POSTGRES_PASSWORD for role initialization, so
# starting it with the new value does not rotate the stored credential. Connect with
# the operator-supplied legacy credential over TCP, rotate inside PostgreSQL, then
# verify the replacement credential before provisioning the separate runtime role.
# Secrets are inherited through the exec environment rather than rendered into
# Docker or psql process arguments.
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" docker compose up --detach --wait --wait-timeout 90 postgres

PGPASSWORD="$LEGACY_POSTGRES_PASSWORD" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  docker compose exec --no-TTY -e PGPASSWORD -e POSTGRES_PASSWORD \
  postgres psql \
  --no-psqlrc \
  --host=127.0.0.1 \
  --username "$EFFECTIVE_POSTGRES_USER" \
  --dbname "$EFFECTIVE_POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 <<'SQL'
\getenv next_admin_password POSTGRES_PASSWORD
ALTER ROLE lifeos PASSWORD :'next_admin_password';
SQL

PGPASSWORD="$POSTGRES_PASSWORD" \
  docker compose exec --no-TTY -e PGPASSWORD \
  postgres psql \
  --no-psqlrc \
  --host=127.0.0.1 \
  --username "$EFFECTIVE_POSTGRES_USER" \
  --dbname "$EFFECTIVE_POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --command='SELECT current_user' >/dev/null

POSTGRES_PASSWORD="$POSTGRES_PASSWORD" NOTIFICATION_RUNTIME_DATABASE_PASSWORD="$NOTIFICATION_RUNTIME_DATABASE_PASSWORD" docker compose run --rm --no-deps notification-db-provision

echo 'upgrade_result=legacy_local_postgres_rotated'
