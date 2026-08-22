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
      'REVOKE ALL PRIVILEGES ON TABLE\n  notification_service.data_rights_erasure_receipts,\n  notification_service.data_rights_erasure_authorizations\nFROM :"service_runtime_role";',
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

  it('documents separate local migration and runtime identities', () => {
    expect(environmentExample).toContain(
      'NOTIFICATION_MIGRATION_DATABASE_URL=postgresql://lifeos_migrator:lifeos@postgres:5432/lifeos',
    );
    expect(environmentExample).toContain(
      'NOTIFICATION_DATABASE_RUNTIME_ROLE=lifeos',
    );
    expect(environmentExample).toContain(
      'NOTIFICATION_DATABASE_URL=postgresql://lifeos:lifeos@postgres:5432/lifeos',
    );
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
