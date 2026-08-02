import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';

export function requireTitle(body: { title?: unknown } | undefined): string {
  const title = body?.title;
  if (typeof title !== 'string' || !title.trim()) {
    throw new BadRequestException('title is required');
  }
  return title.trim();
}

export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof Error && error.message.endsWith('not found')) {
    return new NotFoundException(error.message);
  }

  if (error instanceof Error) {
    return new BadRequestException(error.message);
  }

  return new BadRequestException('Invalid request');
}
