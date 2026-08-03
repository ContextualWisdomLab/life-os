import { HttpException } from '@nestjs/common';

export interface PlanningProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

const VALIDATION_MESSAGES = new Set([
  'Title is required',
  'Identifier must be an opaque non-numeric string',
]);

function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: PlanningProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

export function requireTitle(body: { title?: unknown } | undefined): string {
  const title = body?.title;
  if (typeof title !== 'string' || !title.trim()) {
    throw problemException(400, 'A title is required', 'invalid_title');
  }
  return title.trim();
}

export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof Error && error.message.endsWith('not found')) {
    return problemException(404, 'Planning record not found', 'not_found');
  }

  if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
    return problemException(400, 'Planning request is invalid', 'invalid_request');
  }

  return problemException(
    503,
    'Planning persistence is unavailable',
    'persistence_unavailable',
  );
}
