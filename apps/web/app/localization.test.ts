import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  chooseSupportedLocale,
  formatMessage,
  getMessageCatalog,
  messageCatalogKeys,
  resolveSupportedLocale,
} from './localization';

describe('supported locale resolution', () => {
  it('accepts allowlisted base and regional locale forms', () => {
    assert.equal(resolveSupportedLocale('en-US'), 'en');
    assert.equal(resolveSupportedLocale('ko_KR'), 'ko');
    assert.equal(resolveSupportedLocale(' fr-FR '), null);
    assert.equal(resolveSupportedLocale({}), null);
  });

  it('prefers a saved locale, then browser order, then English', () => {
    assert.equal(chooseSupportedLocale('ko-KR', ['en-US']), 'ko');
    assert.equal(chooseSupportedLocale('fr-FR', ['ja-JP', 'en-GB']), 'en');
    assert.equal(chooseSupportedLocale(undefined, ['ko-KR', 'en-US']), 'ko');
    assert.equal(chooseSupportedLocale(null, []), 'en');
  });
});

describe('localized message catalogs', () => {
  it('keeps Korean and English catalogs structurally complete', () => {
    assert.deepEqual(
      messageCatalogKeys(getMessageCatalog('ko')),
      messageCatalogKeys(getMessageCatalog('en')),
    );
  });

  it('interpolates named values and leaves unknown placeholders visible', () => {
    const english = getMessageCatalog('en');
    assert.equal(
      formatMessage(english, 'completedCountLabel', { count: 3 }),
      '3 actions completed',
    );
    assert.equal(formatMessage(english, 'todayDate'), 'Today · {date}');
  });
});
