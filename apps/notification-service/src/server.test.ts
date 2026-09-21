import { describe, expect, it, vi } from 'vitest';
import type { NotificationHttpService } from './notification-http';
import {
  runNotificationServer,
  type NotificationServerProcess,
} from './server';

/** Creates one process facade that records shutdown hooks and credential-free errors. */
function processFacade(): NotificationServerProcess & {
  readonly listeners: Map<'SIGINT' | 'SIGTERM', () => void>;
  readonly errors: string[];
} {
  const listeners = new Map<'SIGINT' | 'SIGTERM', () => void>();
  const errors: string[] = [];
  return {
    listeners,
    errors,
    exitCode: undefined,
    once(signal, listener) {
      listeners.set(signal, listener);
      return this;
    },
    stderr: {
      write(message) {
        errors.push(message);
        return true;
      },
    },
  };
}

/** Creates one running HTTP service with a controllable close boundary. */
function service(close: () => Promise<void>): NotificationHttpService {
  return {
    server: {} as NotificationHttpService['server'],
    runtime: {} as NotificationHttpService['runtime'],
    close,
  };
}

describe('Notification production server entrypoint', () => {
  it('boots once, installs both shutdown hooks, and closes at most once', async () => {
    const close = vi.fn(async () => undefined);
    const running = service(close);
    const bootstrap = vi.fn(async () => running);
    const processLike = processFacade();

    await expect(
      runNotificationServer(bootstrap, processLike),
    ).resolves.toBe(running);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect([...processLike.listeners.keys()].sort()).toEqual([
      'SIGINT',
      'SIGTERM',
    ]);

    processLike.listeners.get('SIGTERM')?.();
    processLike.listeners.get('SIGINT')?.();
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(processLike.errors).toEqual([]);
    expect(processLike.exitCode).toBeUndefined();
  });

  it('reports shutdown failure without reflecting dependency details', async () => {
    const running = service(async () => {
      throw new Error('postgres://user:password@internal-db');
    });
    const processLike = processFacade();
    await runNotificationServer(async () => running, processLike);

    processLike.listeners.get('SIGTERM')?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(processLike.exitCode).toBe(1);
    expect(processLike.errors).toEqual([
      'Notification service shutdown failed\n',
    ]);
    expect(processLike.errors.join('')).not.toContain('password');
  });

  it('propagates startup failure to the caller without installing shutdown hooks', async () => {
    const processLike = processFacade();
    await expect(
      runNotificationServer(async () => {
        throw new Error('Notification HTTP bootstrap failed');
      }, processLike),
    ).rejects.toThrow(/^Notification HTTP bootstrap failed$/u);
    expect(processLike.listeners.size).toBe(0);
  });
});
