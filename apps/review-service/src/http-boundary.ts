import { HttpException } from '@nestjs/common';
import {
  ReviewCompletionConflictError,
  ReviewValidationError,
  requireReviewLimit,
  requireReviewRitualKind,
  requireReviewWorkspaceId,
  type ReviewRitualKind,
} from './review-domain';
import { ReviewPersistenceError } from './postgres-review-repository';

/** Bounded problem-details response returned by the Review HTTP boundary. */
export interface ReviewProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: ReviewProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

/** Requires a tenant UUIDv4 exclusively from the trusted workspace header. */
export function requireWorkspaceHeader(value: string | undefined): string {
  try {
    return requireReviewWorkspaceId(value);
  } catch {
    throw problemException(
      400,
      'A valid x-workspace-id header is required',
      'invalid_workspace',
    );
  }
}

/** Requires a supported ritual kind from the bounded route parameter. */
export function requireRitualPath(value: string): ReviewRitualKind {
  try {
    return requireReviewRitualKind(value);
  } catch {
    throw problemException(
      400,
      'Review ritual kind is invalid',
      'invalid_ritual',
    );
  }
}

/** Requires a bounded deterministic history page size. */
export function requireHistoryLimit(value: string | undefined): number {
  try {
    return requireReviewLimit(value);
  } catch {
    throw problemException(
      400,
      'Review history limit is invalid',
      'invalid_limit',
    );
  }
}

/** Maps domain and persistence failures to credential-free HTTP problems. */
export function toReviewHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof ReviewCompletionConflictError) {
    return problemException(
      409,
      'Review completion conflicts with immutable evidence',
      'completion_conflict',
    );
  }
  if (error instanceof ReviewValidationError) {
    return problemException(
      400,
      'Review request is invalid',
      'invalid_request',
    );
  }
  if (error instanceof ReviewPersistenceError) {
    return problemException(
      503,
      'Review persistence is unavailable',
      'persistence_unavailable',
    );
  }
  return problemException(
    503,
    'Review service is unavailable',
    'service_unavailable',
  );
}
