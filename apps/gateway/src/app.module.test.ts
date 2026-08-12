import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HealthController } from './app.module';

const TODAY_DEPENDENCY_KEYS = [
  'IDENTITY_SERVICE_ORIGIN',
  'PLANNING_SERVICE_ORIGIN',
  'PLANNING_GATEWAY_CONTEXT_SECRET',
] as const;

/** Returns a stable problem object from one expected gateway HTTP failure. */
function problem(error: unknown): Readonly<Record<string, unknown>> {
  expect(error).toBeInstanceOf(HttpException);
  const response = (error as HttpException).getResponse();
  expect(response).toBeTypeOf('object');
  return response as Readonly<Record<string, unknown>>;
}

/** Runs one assertion with Today upstream configuration deterministically absent. */
async function withoutTodayDependencies<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = TODAY_DEPENDENCY_KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of TODAY_DEPENDENCY_KEYS) delete process.env[key];
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('Gateway Today HTTP boundary', () => {
  it('rejects a missing Today date before any dependency configuration is consulted', async () => {
    const controller = new HealthController();

    try {
      await controller.today(undefined, undefined);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(400);
      expect(problem(error)).toEqual({
        type: 'about:blank',
        title: 'Today composition request is invalid',
        status: 400,
        code: 'invalid_today_request',
      });
      return;
    }
    throw new Error('Expected an invalid Today request to fail closed');
  });

  it('keeps Today unavailable when trusted dependency configuration is absent', async () => {
    const controller = new HealthController();

    try {
      await withoutTodayDependencies(() =>
        controller.today(undefined, '2026-08-10'),
      );
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect(problem(error)).toEqual({
        type: 'about:blank',
        title: 'Today composition is unavailable',
        status: 503,
        code: 'today_composition_unavailable',
      });
      return;
    }
    throw new Error('Expected unavailable Today dependencies to fail closed');
  });
});
