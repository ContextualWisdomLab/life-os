import {
  bootstrapNotificationService,
  type NotificationHttpService,
} from './notification-http';

/** Process capabilities used by the Notification server without exposing the global process in tests. */
export interface NotificationServerProcess {
  exitCode: number | undefined;
  /** Registers one process shutdown hook. */
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  readonly stderr: {
    /** Writes one credential-free operator message. */
    write(message: string): unknown;
  };
}

/** Production bootstrap boundary supplied by the HTTP composition root. */
export type NotificationServerBootstrap = () => Promise<NotificationHttpService>;

/**
 * Starts one Notification HTTP service and binds process shutdown to its owned
 * listener and PostgreSQL lifecycle. The first SIGINT or SIGTERM owns shutdown;
 * later signals reuse the same close promise rather than racing resource cleanup.
 * Shutdown errors are reduced to a stable operator message and non-zero exit code
 * so socket, database, credential, or topology details never reach stderr.
 */
export async function runNotificationServer(
  bootstrap: NotificationServerBootstrap,
  processLike: NotificationServerProcess,
): Promise<NotificationHttpService> {
  const service = await bootstrap();
  let closing: Promise<void> | undefined;
  const closeOnce = (): void => {
    if (closing === undefined) {
      closing = service.close().catch(() => {
        processLike.stderr.write('Notification service shutdown failed\n');
        processLike.exitCode = 1;
      });
    }
  };
  processLike.once('SIGINT', closeOnce);
  processLike.once('SIGTERM', closeOnce);
  return service;
}

/** Starts the production server using the real environment-backed composition root. */
export async function runProductionNotificationServer(): Promise<NotificationHttpService> {
  return await runNotificationServer(bootstrapNotificationService, process);
}
