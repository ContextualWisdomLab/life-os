import { Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  NOTIFICATION_DATA_RIGHTS_RUNTIME,
  NotificationDataRightsController,
} from './notification-data-rights-controller';
import {
  createNotificationRuntime,
  type NotificationRuntime,
} from './notification-runtime';

const DEFAULT_NOTIFICATION_HOST = '0.0.0.0';
const DEFAULT_NOTIFICATION_PORT = 4300;
const DECIMAL_PORT_PATTERN = /^[1-9]\d{0,4}$/u;
const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9.:_-]+$/u;

/** Environment values accepted by the Notification HTTP composition root. */
export type NotificationHttpEnvironment = Readonly<
  Record<string, string | undefined>
>;

/** Minimal application lifecycle used by the Notification composition root. */
export interface NotificationHttpApplication {
  /** Places all controllers under the versioned LifeOS service prefix. */
  setGlobalPrefix(prefix: string): unknown;
  /** Enables runtime cleanup on supported process shutdown signals. */
  enableShutdownHooks(): unknown;
  /** Starts the bounded internal listener. */
  listen(port: number, hostname: string): Promise<unknown>;
  /** Releases Nest-owned resources if startup fails after application creation. */
  close?(): Promise<unknown>;
}

/** Factory boundary for Nest application creation so startup behavior is testable without sockets. */
export type NotificationHttpApplicationFactory = (
  module: DynamicModule,
) => Promise<NotificationHttpApplication>;

/** Factory boundary for the service-owned durable runtime. */
export type NotificationRuntimeFactory = (
  environment: NotificationHttpEnvironment,
) => NotificationRuntime;

@Module({})
class NotificationHttpModule {}

/** Registers the private authenticated controller over exactly one supplied Notification runtime. */
export function createNotificationHttpModule(
  runtime: NotificationRuntime,
): DynamicModule {
  return {
    module: NotificationHttpModule,
    controllers: [NotificationDataRightsController],
    providers: [
      {
        provide: NOTIFICATION_DATA_RIGHTS_RUNTIME,
        useValue: runtime,
      },
    ],
  };
}

/** Requires a decimal non-privileged TCP port before durable runtime construction. */
function notificationPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_NOTIFICATION_PORT;
  if (!DECIMAL_PORT_PATTERN.test(value)) {
    throw new Error('Notification port is invalid');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error('Notification port is invalid');
  }
  return parsed;
}

/** Requires one bounded host token without whitespace or shell/control characters. */
function notificationHost(value: string | undefined): string {
  if (value === undefined) return DEFAULT_NOTIFICATION_HOST;
  if (!HOST_PATTERN.test(value)) {
    throw new Error('Notification host is invalid');
  }
  return value;
}

/** Creates the production Nest application without exposing framework details to tests. */
async function defaultApplicationFactory(
  module: DynamicModule,
): Promise<NotificationHttpApplication> {
  return await NestFactory.create(module);
}

/**
 * Boots the deployable Notification HTTP process that owns the authenticated
 * data-rights contributor endpoint. Listener configuration is validated before
 * PostgreSQL construction. The `v1` prefix is set before listening so the path
 * covered by the service HMAC is byte-for-byte identical to the reachable route.
 * Startup failures close durable resources and expose no connection details.
 */
export async function bootstrapNotificationService(
  environment: NotificationHttpEnvironment = process.env,
  runtimeFactory: NotificationRuntimeFactory = createNotificationRuntime,
  applicationFactory: NotificationHttpApplicationFactory =
    defaultApplicationFactory,
): Promise<NotificationHttpApplication> {
  const port = notificationPort(environment.NOTIFICATION_PORT);
  const host = notificationHost(environment.NOTIFICATION_HOST);
  const runtime = runtimeFactory(environment);
  let application: NotificationHttpApplication | undefined;
  try {
    application = await applicationFactory(createNotificationHttpModule(runtime));
    application.setGlobalPrefix('v1');
    application.enableShutdownHooks();
    await application.listen(port, host);
    return application;
  } catch {
    if (application?.close) {
      await application.close().catch(() => undefined);
    }
    await runtime.close().catch(() => undefined);
    throw new Error('Notification HTTP bootstrap failed');
  }
}
