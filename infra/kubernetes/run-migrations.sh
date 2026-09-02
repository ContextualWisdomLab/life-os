#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly REQUIRED_CONFIRMATION='apply-forward-only'
readonly MIGRATION_SCHEMA='life_os_deployment'
readonly MIGRATION_TABLE='schema_migrations'
readonly SERVICE_WRITER='infra/kubernetes/write-pg-service.py'

fail() {
  printf 'migration_error=%s\n' "$1" >&2
  exit 1
}

[[ "${LIFE_OS_MIGRATION_CONFIRMATION:-}" == "${REQUIRED_CONFIRMATION}" ]] ||
  fail 'explicit_confirmation_required'
command -v psql >/dev/null 2>&1 || fail 'psql_not_available'
command -v sha256sum >/dev/null 2>&1 || fail 'sha256sum_not_available'
command -v mktemp >/dev/null 2>&1 || fail 'mktemp_not_available'
command -v python >/dev/null 2>&1 || fail 'python_not_available'
[[ -f "${SERVICE_WRITER}" ]] || fail 'service_writer_not_available'

migration_roots=(
  'identity|IDENTITY_DATABASE_URL|apps/identity-service/migrations'
  'planning|PLANNING_DATABASE_URL|apps/planning-service/migrations'
  'habit|HABIT_DATABASE_URL|apps/habit-service/migrations'
  'ai|AI_DATABASE_URL|apps/ai-service/migrations'
  'review|REVIEW_DATABASE_URL|apps/review-service/migrations'
  'notification|NOTIFICATION_MIGRATION_DATABASE_URL|apps/notification-service/migrations|NOTIFICATION_DATABASE_RUNTIME_ROLE'
)

append_migration_command() {
  local command_file="$1"
  local service_name="$2"
  local migration_file="$3"
  local migration_name="$4"
  local migration_sequence="$5"
  local migration_sha="$6"

  cat >>"${command_file}" <<SQL
\\set service_name '${service_name}'
\\set migration_name '${migration_name}'
\\set migration_sequence '${migration_sequence}'
\\set migration_sha256 '${migration_sha}'
SELECT
  EXISTS (
    SELECT 1
    FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
    WHERE service_name = :'service_name'
      AND migration_name = :'migration_name'
  ) AS migration_exists,
  COALESCE(
    (
      SELECT migration_sha256 = :'migration_sha256'
      FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
      WHERE service_name = :'service_name'
        AND migration_name = :'migration_name'
    ),
    false
  ) AS migration_digest_matches,
  COALESCE(
    (
      SELECT migration_status = 'applied'
      FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
      WHERE service_name = :'service_name'
        AND migration_name = :'migration_name'
    ),
    false
  ) AS migration_is_applied,
  COALESCE(
    (
      SELECT MAX(migration_sequence)
      FROM ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
      WHERE service_name = :'service_name'
    ),
    -1
  ) AS latest_migration_sequence
\\gset
\\if :migration_exists
  \\if :migration_digest_matches
    \\if :migration_is_applied
      \\echo migration_status=already_applied service=:service_name migration=:migration_name
    \\else
      \\echo migration_error=incomplete_migration_requires_reconciliation service=:service_name migration=:migration_name
      \\quit 1
    \\endif
  \\else
    \\echo migration_error=migration_digest_changed service=:service_name migration=:migration_name
    \\quit 1
  \\endif
\\else
  SELECT (:'migration_sequence')::integer > :latest_migration_sequence
    AS migration_sequence_is_forward
  \\gset
  \\if :migration_sequence_is_forward
    INSERT INTO ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
      service_name,
      migration_name,
      migration_sequence,
      migration_sha256,
      migration_status
    ) VALUES (
      :'service_name',
      :'migration_name',
      (:'migration_sequence')::integer,
      :'migration_sha256',
      'applying'
    );
    \\echo migration_status=applying service=:service_name migration=:migration_name
    \\i ${migration_file}
    UPDATE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
    SET migration_status = 'applied',
        applied_at = clock_timestamp()
    WHERE service_name = :'service_name'
      AND migration_name = :'migration_name'
      AND migration_sha256 = :'migration_sha256'
      AND migration_status = 'applying';
    \\echo migration_status=applied service=:service_name migration=:migration_name
  \\else
    \\echo migration_error=migration_sequence_not_forward service=:service_name migration=:migration_name latest=:latest_migration_sequence
    \\quit 1
  \\endif
\\endif
SQL
}

append_notification_owner_check() {
  local command_file="$1"

  cat >>"${command_file}" <<'SQL'
SELECT
  COALESCE((
    SELECT pg_get_userbyid(namespace.nspowner) = current_user
    FROM pg_catalog.pg_namespace AS namespace
    WHERE namespace.nspname = 'notification_service'
  ), false)
  AND COALESCE((
    SELECT pg_get_userbyid(relation.relowner) = current_user
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = to_regclass('notification_service.reminder_occurrences')
  ), false)
  AND COALESCE((
    SELECT pg_get_userbyid(relation.relowner) = current_user
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = to_regclass('notification_service.reminder_outcomes')
  ), false)
  AND COALESCE((
    SELECT pg_get_userbyid(relation.relowner) = current_user
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = to_regclass('notification_service.inbox_messages')
  ), false)
  AND COALESCE((
    SELECT pg_get_userbyid(procedure.proowner) = current_user
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = to_regprocedure(
      'notification_service.reject_reminder_outcome_mutation()'
    )
  ), false)
  AS notification_migration_owner_ready
\gset
\if :notification_migration_owner_ready
\else
  \echo migration_error=notification_migration_owner_mismatch service=notification
  \quit 1
\endif
SQL
}

apply_service_migrations() {
  local service_name="$1"
  local database_url_name="$2"
  local migration_directory="$3"
  local runtime_role_name="${4:-}"
  local service_runtime_role=''
  local migration_file migration_name migration_sequence migration_sha
  local workspace command_file service_file
  local -a migration_files=()

  [[ "${service_name}" =~ ^[a-z][a-z0-9_]*$ ]] || fail 'service_name_invalid'
  shopt -s nullglob
  migration_files=("${migration_directory}"/*.sql)
  shopt -u nullglob

  ((${#migration_files[@]} > 0)) || return 0
  [[ -n "${!database_url_name:-}" ]] || fail "${database_url_name}_required"

  if [[ -n "${runtime_role_name}" ]]; then
    [[ -n "${!runtime_role_name:-}" ]] || fail "${runtime_role_name}_required"
    service_runtime_role="${!runtime_role_name}"
    [[ "${service_runtime_role}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] ||
      fail "${runtime_role_name}_invalid"
  fi

  workspace="$(mktemp -d)"
  command_file="${workspace}/migration_commands.psql"
  service_file="${workspace}/pg_service.conf"
  if ! python "${SERVICE_WRITER}" \
    --environment-variable "${database_url_name}" \
    --service-name "${service_name}" \
    --output "${service_file}"; then
    rm -rf "${workspace}"
    fail "database_service_configuration_failed:${service_name}"
  fi
  unset "${database_url_name}"

  cat >"${command_file}" <<SQL
\\set ON_ERROR_STOP on
SELECT pg_advisory_lock(hashtextextended('life-os-migrations:${service_name}', 0));
CREATE SCHEMA IF NOT EXISTS ${MIGRATION_SCHEMA};
CREATE TABLE IF NOT EXISTS ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (
  service_name text NOT NULL,
  migration_name text NOT NULL,
  migration_sequence integer NOT NULL,
  migration_sha256 character(64) NOT NULL,
  migration_status text NOT NULL,
  applied_at timestamp with time zone,
  PRIMARY KEY (service_name, migration_name),
  CONSTRAINT migration_sequence_range CHECK (
    migration_sequence BETWEEN 0 AND 9999
  ),
  CONSTRAINT migration_sha256_format CHECK (migration_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_status_valid CHECK (migration_status IN ('applying', 'applied')),
  CONSTRAINT migration_applied_at_consistent CHECK (
    (migration_status = 'applying' AND applied_at IS NULL)
    OR (migration_status = 'applied' AND applied_at IS NOT NULL)
  )
);
ALTER TABLE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
  ADD COLUMN IF NOT EXISTS migration_sequence integer;
UPDATE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
SET migration_sequence = substring(migration_name FROM '^[0-9]{4}')::integer
WHERE migration_sequence IS NULL;
ALTER TABLE ${MIGRATION_SCHEMA}.${MIGRATION_TABLE}
  ALTER COLUMN migration_sequence SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_service_sequence_unique
  ON ${MIGRATION_SCHEMA}.${MIGRATION_TABLE} (service_name, migration_sequence);
SQL

  if [[ -n "${service_runtime_role}" ]]; then
    cat >>"${command_file}" <<SQL
\\set service_name '${service_name}'
\\set service_runtime_role '${service_runtime_role}'
SELECT
  current_user = :'service_runtime_role' AS migration_role_matches_runtime_role,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = :'service_runtime_role'
  ) AS service_runtime_role_exists
\\gset
\\if :migration_role_matches_runtime_role
  \\echo migration_error=migration_role_matches_runtime_role service=:service_name
  \\quit 1
\\endif
\\if :service_runtime_role_exists
\\else
  \\echo migration_error=service_runtime_role_missing service=:service_name
  \\quit 1
\\endif
SQL
  fi

  for migration_file in "${migration_files[@]}"; do
    migration_name="$(basename "${migration_file}")"
    [[ "${migration_name}" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]] || {
      rm -rf "${workspace}"
      fail "migration_name_invalid:${service_name}:${migration_name}"
    }
    [[ "${migration_file}" =~ ^[A-Za-z0-9_./-]+$ ]] || {
      rm -rf "${workspace}"
      fail "migration_path_invalid:${service_name}:${migration_name}"
    }
    migration_sequence="${migration_name%%_*}"
    migration_sha="$(sha256sum "${migration_file}" | awk '{print $1}')"
    [[ "${migration_sha}" =~ ^[0-9a-f]{64}$ ]] || {
      rm -rf "${workspace}"
      fail "migration_digest_invalid:${service_name}:${migration_name}"
    }
    if [[ "${service_name}" == 'notification' && "${migration_sequence}" != '0001' ]]; then
      append_notification_owner_check "${command_file}"
    fi
    append_migration_command \
      "${command_file}" \
      "${service_name}" \
      "${migration_file}" \
      "${migration_name}" \
      "${migration_sequence}" \
      "${migration_sha}"
  done

  if [[ "${service_name}" == 'notification' ]]; then
    [[ -n "${service_runtime_role}" ]] || {
      rm -rf "${workspace}"
      fail 'NOTIFICATION_DATABASE_RUNTIME_ROLE_required'
    }
    cat >>"${command_file}" <<'SQL'
GRANT USAGE ON SCHEMA notification_service TO :"service_runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE
  notification_service.reminder_occurrences,
  notification_service.inbox_messages
TO :"service_runtime_role";
GRANT SELECT, INSERT ON TABLE
  notification_service.reminder_outcomes
TO :"service_runtime_role";
REVOKE ALL PRIVILEGES ON TABLE
  notification_service.data_rights_erasure_receipts,
  notification_service.data_rights_erasure_authorizations,
  notification_service.data_rights_workspace_erasures,
  notification_service.data_rights_authority_replay_records
FROM :"service_runtime_role";
GRANT SELECT, INSERT, DELETE ON TABLE
  notification_service.data_rights_authority_replay_records
TO :"service_runtime_role";
GRANT EXECUTE ON FUNCTION notification_service.erase_workspace_data(uuid, uuid, uuid, uuid)
TO :"service_runtime_role";
SQL
  fi

  cat >>"${command_file}" <<SQL
SELECT pg_advisory_unlock(hashtextextended('life-os-migrations:${service_name}', 0));
SQL

  if ! PGSERVICEFILE="${service_file}" PGSERVICE="${service_name}" psql \
    --no-psqlrc \
    --no-password \
    --set=ON_ERROR_STOP=1 \
    --file="${command_file}"; then
    rm -rf "${workspace}"
    fail "service_migration_failed:${service_name}"
  fi
  rm -rf "${workspace}"
}

for migration_root in "${migration_roots[@]}"; do
  IFS='|' read -r service_name database_url_name migration_directory runtime_role_name <<<"${migration_root}"
  apply_service_migrations \
    "${service_name}" \
    "${database_url_name}" \
    "${migration_directory}" \
    "${runtime_role_name:-}"
done

printf 'migration_status=completed\n'
