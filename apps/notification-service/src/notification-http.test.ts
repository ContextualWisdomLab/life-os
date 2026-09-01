import { describe, expect, it, vi } from 'vitest';
import type { NotificationRuntime } from './notification-runtime';
import {
  bootstrapNotificationService,
  createNotificationHttpModule,
  type NotificationHttpApplication,
} from './notification-http';
import { NotificationDataRightsController } from './notification-data-rights-controller';

/** Creates a bounded runtime fixture without opening PostgreSQL connections. */
function runtime(): NotificationRuntime {
  return {
    close: vi.fn(async () => undefined),
  } as unknown as NotificationRuntime;
}

describe('Notification internal HTTP composition', () => {
  it('registers the authenticated data-rights controller against the supplied runtime', () => {
    const suppliedRuntime = runtime();
    const module = createNotificationHttpModule(suppliedRuntime);

    expect(module.controllers).toEqual([NotificationDataRightsController]);
    expect(module.providers).toEqual([
      {
        provide: expect.any(Symbol),
        useValue: suppliedRuntime,
      },
    ]);
  });

  it('boots the v1 private route on a validated bounded listener', async () => {
    const suppliedRuntime = runtime();
    const setGlobalPrefix = vi.fn();
    const enableShutdownHooks = vi.fn();
    const listen = vi.fn(async () => undefined);
    const application: NotificationHttpApplication = {
      setGlobalPrefix,
      enableShutdownHooks,
      listen,
    };
    const applicationFactory = vi.fn(async () => application);

    await expect(
      bootstrapNotificationService(
        {
          NOTIFICATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os',
          NOTIFICATION_PORT: '4300',
          NOTIFICATION_HOST: '127.0.0.1',
        },
        () => suppliedRuntime,
        applicationFactory,
      ),
    ).resolves.toBe(application);

    expect(applicationFactory).toHaveBeenCalledTimes(1);
    expect(setGlobalPrefix).toHaveBeenCalledWith('v1');
    expect(enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(4300, '127.0.0.1');
  });

  it.each([
    [{ NOTIFICATION_PORT: '0' }, 'Notification port is invalid'],
    [{ NOTIFICATION_PORT: '65536' }, 'Notification port is invalid'],
    [{ NOTIFICATION_PORT: '4.3e3' }, 'Notification port is invalid'],
    [{ NOTIFICATION_HOST: '' }, 'Notification host is invalid'],
    [{ NOTIFICATION_HOST: ' host ' }, 'Notification host is invalid'],
  ])('rejects unsafe listener configuration before runtime creation', async (override, expected) => {
    const runtimeFactory = vi.fn(() => runtime());
    const applicationFactory = vi.fn();

    await expect(
      bootstrapNotificationService(
        {
          NOTIFICATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os',
          ...override,
        },
        runtimeFactory,
        applicationFactory,
      ),
    ).rejects.toThrow(expected);
    expect(runtimeFactory).not.toHaveBeenCalled();
    expect(applicationFactory).not.toHaveBeenCalled();
  });

  it('closes the runtime if Nest application construction fails', async () => {
    const suppliedRuntime = runtime();
    const runtimeFactory = vi.fn(() => suppliedRuntime);
    const applicationFactory = vi.fn(async () => {
      throw new Error('listener construction failed');
    });

    await expect(
      bootstrapNotificationService(
        { NOTIFICATION_DATABASE_URL: 'postgresql://runtime.invalid/life_os' },
        runtimeFactory,
        applicationFactory,
      ),
    ).rejects.toThrow('Notification HTTP bootstrap failed');
    expect(suppliedRuntime.close).toHaveBeenCalledTimes(1);
  });
});
