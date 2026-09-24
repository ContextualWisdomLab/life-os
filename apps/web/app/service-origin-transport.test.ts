import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireServiceOrigin } from './planning-search-client';

test('service origins fail closed on cleartext except explicit loopback mode', () => {
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

  assert.equal(
    requireServiceOrigin('http://127.0.0.1:4101', 'loopback'),
    'http://127.0.0.1:4101',
  );
  assert.throws(
    () => requireServiceOrigin('http://identity.example.test', 'loopback'),
    new Error('Service origin is invalid'),
  );
});
