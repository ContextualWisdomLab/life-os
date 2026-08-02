import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { requireTitle, toHttpException } from './http-boundary';

describe('planning HTTP boundary', () => {
  it('rejects a missing or blank title as a bad request', () => {
    expect(() => requireTitle({})).toThrow(BadRequestException);
    expect(() => requireTitle({ title: '   ' })).toThrow(BadRequestException);
  });

  it('normalizes a valid title', () => {
    expect(requireTitle({ title: '  Ship MVP  ' })).toBe('Ship MVP');
  });

  it('maps missing parent entities to not found', () => {
    expect(toHttpException(new Error('Goal not found'))).toBeInstanceOf(NotFoundException);
    expect(toHttpException(new Error('Project not found'))).toBeInstanceOf(NotFoundException);
  });

  it('maps validation failures to bad request', () => {
    expect(toHttpException(new Error('Identifier must be an opaque non-numeric string'))).toBeInstanceOf(
      BadRequestException,
    );
  });
});
