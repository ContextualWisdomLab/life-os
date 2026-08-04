import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPlanningSearchAbort,
  LatestPlanningSearchRequest,
  normalizePlanningSearchQuery,
} from './planning-search-state';

describe('planning search query normalization', () => {
  it('normalizes compatibility characters and collapses Unicode whitespace', () => {
    assert.equal(
      normalizePlanningSearchQuery('  Ｒｅｌｅａｓｅ　   evidence  '),
      'Release evidence',
    );
  });
});

describe('latest planning search request', () => {
  it('aborts the predecessor and protects current ownership from stale completion', () => {
    const requests = new LatestPlanningSearchRequest();
    const first = requests.begin();
    const second = requests.begin();

    assert.equal(first.signal.aborted, true);
    assert.equal(requests.isCurrent(first), false);
    assert.equal(requests.isCurrent(second), true);

    requests.finish(first);
    assert.equal(requests.isCurrent(second), true);

    requests.finish(second);
    assert.equal(requests.isCurrent(second), false);
  });

  it('cancels the active request during cleanup', () => {
    const requests = new LatestPlanningSearchRequest();
    const controller = requests.begin();

    requests.cancel();

    assert.equal(controller.signal.aborted, true);
    assert.equal(requests.isCurrent(controller), false);
  });
});

describe('planning search abort detection', () => {
  it('distinguishes intentional aborts from ordinary failures', () => {
    assert.equal(
      isPlanningSearchAbort(new DOMException('cancelled', 'AbortError')),
      true,
    );
    assert.equal(isPlanningSearchAbort(new Error('network failure')), false);
  });
});
