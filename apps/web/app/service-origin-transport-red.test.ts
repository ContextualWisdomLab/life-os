import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireServiceOrigin } from './planning-search-client';

test('service origins reject cleartext HTTP unless a caller explicitly opts in', () => {
  assert.equal(
    requireServiceOrigin('https://identity.example.test'),
    'https://identity.example.test',
  );

  for (const origin of [
    'http://identity.example.test',
    'http://127.0.0.1:4101',
  ]) {
    assert.throws(
      () => requireServiceOrigin(origin),
      new Error('Service origin is invalid'),
    );
  }
});
