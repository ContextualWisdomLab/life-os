import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireAiServiceOrigin } from './ai-proposal-client';

test('AI service origins share the HTTPS-default transport policy', () => {
  assert.equal(
    requireAiServiceOrigin('https://ai.example.test'),
    'https://ai.example.test',
  );
  assert.throws(
    () => requireAiServiceOrigin('http://ai.example.test'),
    new Error('AI service origin is invalid'),
  );
  assert.equal(
    requireAiServiceOrigin('http://127.0.0.1:4105', 'loopback'),
    'http://127.0.0.1:4105',
  );
  assert.throws(
    () => requireAiServiceOrigin('http://ai-service:4105', 'loopback'),
    new Error('AI service origin is invalid'),
  );
});
