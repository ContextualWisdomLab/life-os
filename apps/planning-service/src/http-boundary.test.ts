import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTitle, toHttpException } from './http-boundary';

function responseOf(exception: HttpException): unknown {
  return exception.getResponse();
}

describe('planning HTTP boundary', () => {
  it('rejects a missing or blank title with problem details', () => {
    for (const body of [{}, { title: '   ' }]) {
      try {
        requireTitle(body);
        throw new Error('Expected title validation to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect(responseOf(error as HttpException)).toEqual({
          type: 'about:blank',
          title: 'A title is required',
          status: 400,
          code: 'invalid_title',
        });
      }
    }
  });

  it('normalizes a valid title', () => {
    expect(requireTitle({ title: '  Ship MVP  ' })).toBe('Ship MVP');
  });

  it('maps missing parent entities to credential-free not-found details', () => {
    expect(responseOf(toHttpException(new Error('Goal not found')))).toEqual({
      type: 'about:blank',
      title: 'Planning record not found',
      status: 404,
      code: 'not_found',
    });
    expect(responseOf(toHttpException(new Error('Project not found')))).toEqual(
      {
        type: 'about:blank',
        title: 'Planning record not found',
        status: 404,
        code: 'not_found',
      },
    );
  });

  it.each([
    'Identifier must be an opaque non-numeric string',
    'Planning search request is invalid',
  ])('maps allowlisted validation failure %s to a bad request', (message) => {
    expect(responseOf(toHttpException(new Error(message)))).toEqual({
      type: 'about:blank',
      title: 'Planning request is invalid',
      status: 400,
      code: 'invalid_request',
    });
  });

  it('maps unexpected persistence failures without leaking details', () => {
    const exception = toHttpException(
      new Error('password=secret SELECT * FROM planning.tasks'),
    );
    expect(exception.getStatus()).toBe(503);
    expect(responseOf(exception)).toEqual({
      type: 'about:blank',
      title: 'Planning persistence is unavailable',
      status: 503,
      code: 'persistence_unavailable',
    });
    expect(JSON.stringify(responseOf(exception))).not.toContain('secret');
    expect(JSON.stringify(responseOf(exception))).not.toContain('SELECT');
  });
});
