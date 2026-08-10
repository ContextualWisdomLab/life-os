import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HealthController } from './app.module';

/** Returns a stable problem object from one expected gateway HTTP failure. */
function problem(error: unknown): Readonly<Record<string, unknown>> {
  expect(error).toBeInstanceOf(HttpException);
  const response = (error as HttpException).getResponse();
  expect(response).toBeTypeOf('object');
  return response as Readonly<Record<string, unknown>>;
}

describe('Gateway Today transitional boundary', () => {
  it('never returns fabricated successful Today data while real composition is unavailable', () => {
    const controller = new HealthController();

    try {
      controller.today();
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
    throw new Error('Expected Today composition to fail closed');
  });
});
