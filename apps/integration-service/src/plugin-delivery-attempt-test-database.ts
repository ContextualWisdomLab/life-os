export interface PluginDeliveryAttemptTestDatabaseTarget {
  readonly hostname: string;
  readonly port: string;
  readonly username: string;
  readonly password: string;
  readonly database: string;
  readonly sslMode: string;
}

/** Parses the PostgreSQL target used by the delivery-attempt integration harness. */
export function parsePluginDeliveryAttemptTestDatabaseTarget(
  databaseUrl: string,
): PluginDeliveryAttemptTestDatabaseTarget {
  const target = new URL(databaseUrl);
  return {
    hostname: target.hostname,
    port: target.port || '5432',
    username: decodeURIComponent(target.username),
    password: decodeURIComponent(target.password),
    database: decodeURIComponent(target.pathname.replace(/^\//u, '')),
    sslMode: target.searchParams.get('sslmode') ?? 'prefer',
  };
}
