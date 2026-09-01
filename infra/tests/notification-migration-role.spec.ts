import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');

/** Read one repository-relative UTF-8 file for deterministic authority assertions. */
function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('Notification database migration authority contract', () => {
  const migrationRunner = read('infra/kubernetes/run-migrations.sh');
  const deploymentWorkflow = read('.github/workflows/deploy.yml');
  const environmentExample = read('.env.example');
  const composeConfiguration = read('compose.yaml');
  const erasureMigration = read(
    'apps/notification-service/migrations/0002_data_rights_erasure.sql',
  );

  it('keeps Notification migration ownership distinct from runtime authority', () => {
    expect(migrationRunner).toContain('NOTIFICATION_MIGRATION_DATABASE_URL');
    expect(migrationRunner).toContain('NOTIFICATION_DATABASE_RUNTIME_ROLE');
    expect(migrationRunner).toContain('migration_role_matches_runtime_role');
    expect(migrationRunner).toContain(
      'GRANT USAGE ON SCHEMA notification_service TO :"service_runtime_role"',
    );
    expect(migrationRunner).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE\n  notification_service.data_rights_erasure_receipts,\n  notification_service.data_rights_erasure_authorizations,\n  notification_service.data_rights_workspace_erasures,\n  notification_service.data_rights_authority_replay_records\nFROM :"service_runtime_role";',
    );
    expect(migrationRunner).toContain(
      'GRANT SELECT, INSERT, DELETE ON TABLE\n  notification_service.data_rights_authority_replay_records\nTO :"service_runtime_role";',
    );
    expect(migrationRunner).toContain(
      'GRANT EXECUTE ON FUNCTION notification_service.erase_workspace_data(uuid, uuid, uuid, uuid)',
    );

    const migrationStep =
      deploymentWorkflow.match(
        /- name: Apply forward-only migrations[\s\S]*?\n      - name: /u,
      )?.[0] ?? '';
    expect(migrationStep).toContain(
      'NOTIFICATION_MIGRATION_DATABASE_URL: ${{ secrets.NOTIFICATION_MIGRATION_DATABASE_URL }}',
    );
    expect(migrationStep).toContain(
      'NOTIFICATION_DATABASE_RUNTIME_ROLE: ${{ vars.NOTIFICATION_DATABASE_RUNTIME_ROLE }}',
    );
    expect(migrationStep).not.toContain('NOTIFICATION_DATABASE_URL:');
  });

  it('documents a local migration authority that is distinct from the Notification runtime', () => {
    expect(environmentExample).toContain(
      'NOTIFICATION_MIGRATION_DATABASE_URL=postgresql://lifeos:replace-with-local-postgres-password@postgres:5432/lifeos',
    );
    expect(environmentExample).toContain(
      'NOTIFICATION_DATABASE_RUNTIME_ROLE=lifeos_notification',
    );
    expect(environmentExample).toContain(
      'NOTIFICATION_DATABASE_URL=postgresql://lifeos_notification:replace-with-distinct-local-runtime-password@postgres:5432/lifeos',
    );
    expect(environmentExample).toContain(
      'NOTIFICATION_RUNTIME_DATABASE_PASSWORD=replace-with-distinct-local-runtime-password',
    );
  });

  it('provisions the configured least-privilege Notification runtime on fresh and existing Compose volumes without committed credentials', () => {
    expect(composeConfiguration).toContain('notification-db-provision:');
    expect(composeConfiguration).toContain(
      './infra/postgres/provision/notification-runtime.psql:/provision/notification-runtime.psql:ro',
    );
    expect(composeConfiguration).toContain(
      'NOTIFICATION_RUNTIME_DATABASE_PASSWORD: ${NOTIFICATION_RUNTIME_DATABASE_PASSWORD:?Set NOTIFICATION_RUNTIME_DATABASE_PASSWORD}',
    );
    expect(composeConfiguration).toContain(
      'NOTIFICATION_DATABASE_RUNTIME_ROLE: ${NOTIFICATION_DATABASE_RUNTIME_ROLE:-lifeos_notification}',
    );
    expect(composeConfiguration).not.toContain(
      '/docker-entrypoint-initdb.d/001_notification_migrator.sql',
    );
    expect(composeConfiguration).not.toContain('POSTGRES_PASSWORD: lifeos');

    const localProvisioning = read(
      'infra/postgres/provision/notification-runtime.psql',
    );
    expect(localProvisioning).toContain(
      '\\getenv runtime_role NOTIFICATION_DATABASE_RUNTIME_ROLE',
    );
    const collisionGuard = localProvisioning.indexOf(
      "SELECT current_user = :'runtime_role' AS runtime_role_matches_admin",
    );
    const roleMutation = localProvisioning.indexOf('ALTER ROLE :"runtime_role"');
    expect(collisionGuard).toBeGreaterThanOrEqual(0);
    expect(localProvisioning).toContain(
      'provision_error=notification_runtime_role_matches_admin',
    );
    expect(collisionGuard).toBeLessThan(roleMutation);
    expect(localProvisioning).toContain("rolname = :'runtime_role'");
    expect(localProvisioning).toContain('ALTER ROLE :"runtime_role"');
    expect(localProvisioning).toContain('TO :"runtime_role"');
    expect(localProvisioning).toContain('COMMENT ON ROLE :"runtime_role"');
    expect(localProvisioning).toContain('LOGIN');
    expect(localProvisioning).toContain('NOSUPERUSER');
    expect(localProvisioning).toContain('NOCREATEDB');
    expect(localProvisioning).toContain('NOCREATEROLE');
    expect(localProvisioning).toContain('NOINHERIT');
    expect(localProvisioning).toContain(
      "\\getenv runtime_password NOTIFICATION_RUNTIME_DATABASE_PASSWORD",
    );
    expect(localProvisioning).not.toMatch(/PASSWORD\s+'[^']+'/u);
    expect(localProvisioning).not.toContain('CREATE ROLE lifeos_notification');
  });

  it('transfers legacy Notification object ownership to the migration authority', () => {
    expect(erasureMigration).toContain(
      'ALTER SCHEMA notification_service OWNER TO CURRENT_USER',
    );
    expect(erasureMigration).toContain(
      'ALTER TABLE notification_service.reminder_occurrences OWNER TO CURRENT_USER',
    );
    expect(erasureMigration).toContain(
      'ALTER TABLE notification_service.reminder_outcomes OWNER TO CURRENT_USER',
    );
    expect(erasureMigration).toContain(
      'ALTER TABLE notification_service.inbox_messages OWNER TO CURRENT_USER',
    );
    expect(erasureMigration).toContain(
      'ALTER FUNCTION notification_service.reject_reminder_outcome_mutation() OWNER TO CURRENT_USER',
    );
  });
});
