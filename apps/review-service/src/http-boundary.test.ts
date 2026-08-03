import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  requireHistoryLimit,
  requireRitualPath,
  requireWorkspaceHeader,
  toReviewHttpException,
} from './http-boundary';
import {
  ReviewCompletionConflictError,
  ReviewValidationError,
} from './review-domain';
import { ReviewPersistenceError } from './postgres-review-repository';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';

function response(error: HttpException): unknown {
  return error.getResponse();
}

describe('Review HTTP boundary', () => {
  it('accepts only bounded workspace, ritual, and history values', () => {
    expect(requireWorkspaceHeader(WORKSPACE_ID.toUpperCase())).toBe(
      WORKSPACE_ID,
    );
    expect(requireRitualPath('weekly-review')).toBe('weekly-review');
    expect(requireHistoryLimit(undefined)).toBe(50);
    expect(requireHistoryLimit('100')).toBe(100);
  });

  it.each([
    () => requireWorkspaceHeader('not-a-workspace'),
    () => requireRitualPath('execute'),
    () => requireHistoryLimit('101'),
  ])('returns bounded problems for invalid boundary input', (operation) => {
    expect(operation).toThrow(HttpException);
  });

  it('maps known failures without leaking exception details', () => {
    const conflict = toReviewHttpException(new ReviewCompletionConflictError());
    expect(response(conflict)).toEqual({
      type: 'about:blank',
      title: 'Review completion conflicts with immutable evidence',
      status: 409,
      code: 'completion_conflict',
    });

    expect(
      response(toReviewHttpException(new ReviewValidationError('secret'))),
    ).toMatchObject({ status: 400, code: 'invalid_request' });
    expect(
      response(toReviewHttpException(new ReviewPersistenceError())),
    ).toMatchObject({ status: 503, code: 'persistence_unavailable' });
    expect(
      JSON.stringify(
        toReviewHttpException(new Error('database password')).getResponse(),
      ),
    ).not.toContain('password');
  });
});
