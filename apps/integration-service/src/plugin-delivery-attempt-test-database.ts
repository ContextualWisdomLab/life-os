const TEST_DATABASE = 'life_os_integration';
const TEST_ROLE = 'life_os';
const TLS_MODES = new Set(['disable', 'require', 'verify-ca', 'verify-full']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export interface PluginDeliveryAttemptTestDatabaseTarget {
  readonly hostname: string;
  readonly port: string;
  readonly username: string;
  readonly password: string;
  readonly database: string;
  readonly sslMode: 'disable' | 'require' | 'verify-ca' | 'verify-full';
}

function invalidTarget(message: string): never {
  throw new Error(message);
}

/** Parses only the dedicated PostgreSQL target allowed to receive destructive Integration test setup. */
export function parsePluginDeliveryAttemptTestDatabaseTarget(
  databaseUrl: string,
): PluginDeliveryAttemptTestDatabaseTarget {
  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    return invalidTarget(
      'A dedicated Integration test database URL is required',
    );
  }
  if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
    return invalidTarget(
      'A dedicated Integration test database URL is required',
    );
  }

  let username: string;
  let password: string;
  let database: string;
  try {
    username = decodeURIComponent(target.username);
    password = decodeURIComponent(target.password);
    database = decodeURIComponent(target.pathname.replace(/^\//u, ''));
  } catch {
    return invalidTarget(
      'A dedicated Integration test database URL is required',
    );
  }
  if (username !== TEST_ROLE || database !== TEST_DATABASE) {
    return invalidTarget(
      'A dedicated Integration test database and role are required',
    );
  }

  const sslModes = target.searchParams.getAll('sslmode');
  if (sslModes.length !== 1 || !TLS_MODES.has(sslModes[0] ?? '')) {
    return invalidTarget(
      'An explicit sslmode is required for the Integration test database',
    );
  }
  const sslMode =
    sslModes[0] as PluginDeliveryAttemptTestDatabaseTarget['sslMode'];
  if (
    sslMode === 'disable' &&
    !LOOPBACK_HOSTS.has(target.hostname.toLowerCase())
  ) {
    return invalidTarget(
      'sslmode=disable is allowed only for a loopback Integration test database',
    );
  }

  return {
    hostname: target.hostname,
    port: target.port || '5432',
    username,
    password,
    database,
    sslMode,
  };
}
