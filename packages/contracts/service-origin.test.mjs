import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireSecureServiceOrigin } from './dist/service-origin.js';

test('service origin transport is HTTPS by default with explicit loopback-only HTTP', () => {
  assert.equal(
    requireSecureServiceOrigin('https://identity.example.test'),
    'https://identity.example.test',
  );

  for (const origin of [
    'http://identity.example.test',
    'http://127.0.0.1:4101',
    'ftp://127.0.0.1:4101',
    'https://user:secret@identity.example.test',
    'https://identity.example.test/path',
    'https://identity.example.test/?query=1',
    'https://identity.example.test/#fragment',
  ]) {
    assert.throws(() => requireSecureServiceOrigin(origin));
  }

  for (const origin of [
    'http://identity.example.test',
    'http://10.0.0.2:4101',
  ]) {
    assert.throws(() => requireSecureServiceOrigin(origin, 'loopback'));
  }

  assert.equal(
    requireSecureServiceOrigin('http://127.0.0.1:4101', 'loopback'),
    'http://127.0.0.1:4101',
  );
  assert.equal(
    requireSecureServiceOrigin('http://localhost:4101', 'loopback'),
    'http://localhost:4101',
  );
  assert.equal(
    requireSecureServiceOrigin('http://[::1]:4101', 'loopback'),
    'http://[::1]:4101',
  );
});
