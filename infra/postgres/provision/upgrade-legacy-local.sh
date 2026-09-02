#!/usr/bin/env bash
set -Eeuo pipefail

: "${LEGACY_POSTGRES_PASSWORD:?Set LEGACY_POSTGRES_PASSWORD to the password currently stored by the legacy local volume}"
: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD to a new local administrator password}"
: "${NOTIFICATION_RUNTIME_DATABASE_PASSWORD:?Set NOTIFICATION_RUNTIME_DATABASE_PASSWORD to a distinct runtime password}"

if [[ "${POSTGRES_USER:-lifeos}" != 'lifeos' ]]; then
  echo 'upgrade_error=legacy_postgres_user_must_be_lifeos' >&2
  exit 1
fi
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

# An existing data directory ignores POSTGRES_PASSWORD for role initialization, so
# starting it with the new value does not rotate the stored credential. Connect with
# the operator-supplied legacy credential, rotate inside PostgreSQL, then verify the
# new credential before provisioning the separate runtime role.
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" docker compose up --detach --wait --wait-timeout 90 postgres

POSTGRES_PASSWORD="$POSTGRES_PASSWORD" docker compose exec --no-TTY \
  -e PGPASSWORD="$LEGACY_POSTGRES_PASSWORD" \
  postgres psql \
  --no-psqlrc \
  --username lifeos \
  --dbname "${POSTGRES_DB:-lifeos}" \
  --set=ON_ERROR_STOP=1 \
  --set=next_admin_password="$POSTGRES_PASSWORD" <<'SQL'
ALTER ROLE lifeos PASSWORD :'next_admin_password';
SQL

POSTGRES_PASSWORD="$POSTGRES_PASSWORD" docker compose exec --no-TTY \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  postgres psql \
  --no-psqlrc \
  --username lifeos \
  --dbname "${POSTGRES_DB:-lifeos}" \
  --set=ON_ERROR_STOP=1 \
  --command='SELECT current_user' >/dev/null

POSTGRES_PASSWORD="$POSTGRES_PASSWORD" NOTIFICATION_RUNTIME_DATABASE_PASSWORD="$NOTIFICATION_RUNTIME_DATABASE_PASSWORD" docker compose run --rm --no-deps notification-db-provision

echo 'upgrade_result=legacy_local_postgres_rotated'
