import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTaskCompletionState } from './http-boundary';

/** Requires hostile command shapes to fail at the HTTP validation boundary. */
function expectInvalid(body: unknown): void {
  let thrown: unknown;
  try {
    requireTaskCompletionState(body);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(HttpException);
  expect((thrown as HttpException).getStatus()).toBe(400);
}

describe('Planning task completion command shape', () => {
  it('accepts exactly one own enumerable boolean data property', () => {
    expect(requireTaskCompletionState({ completed: true })).toBe(true);
    expect(requireTaskCompletionState({ completed: false })).toBe(false);
  });

  it('rejects an enumerable completed accessor before invoking it', () => {
    let reads = 0;
    const body = Object.defineProperty({}, 'completed', {
      enumerable: true,
      get: () => {
        reads += 1;
        return true;
      },
    });

    expectInvalid(body);
    expect(reads).toBe(0);
  });

  it('rejects an enumerable symbol property beside completed', () => {
    const marker = Symbol('completion-shadow');
    const body = { completed: true, [marker]: 'unexpected' };

    expectInvalid(body);
  });

  it('rejects a non-enumerable extra property beside completed', () => {
    const body = Object.defineProperty(
      { completed: true },
      'completedAt',
      { value: '2026-09-10T16:00:00.000Z', enumerable: false },
    );

    expectInvalid(body);
  });
});
