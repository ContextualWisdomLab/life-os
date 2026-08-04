import englishMessages from '../messages/en.json';
import koreanMessages from '../messages/ko.json';

/** Locales with complete, reviewed core-workflow catalogs. */
export type SupportedLocale = 'en' | 'ko';

/** Every translatable key required by the English source catalog. */
export type MessageKey = keyof typeof englishMessages;

/** A catalog must provide one string for every source-catalog key. */
export type MessageCatalog = Readonly<Record<MessageKey, string>>;

const catalogs: Readonly<Record<SupportedLocale, MessageCatalog>> = {
  en: englishMessages,
  ko: koreanMessages,
};

/** Resolves a BCP 47-like locale value to one supported language. */
export function resolveSupportedLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/gu, '-');
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'ko' || normalized.startsWith('ko-')) return 'ko';
  return null;
}

/**
 * Chooses a locale from an explicit saved preference, then browser preferences,
 * and finally English. Unsupported or malformed values never become catalog keys.
 */
export function chooseSupportedLocale(
  savedPreference: unknown,
  browserPreferences: readonly unknown[],
): SupportedLocale {
  const savedLocale = resolveSupportedLocale(savedPreference);
  if (savedLocale) return savedLocale;
  for (const preference of browserPreferences) {
    const browserLocale = resolveSupportedLocale(preference);
    if (browserLocale) return browserLocale;
  }
  return 'en';
}

/** Returns the immutable catalog for an allowlisted locale. */
export function getMessageCatalog(locale: SupportedLocale): MessageCatalog {
  return catalogs[locale];
}

/**
 * Replaces named placeholders while leaving unknown placeholders visible so
 * catalog drift fails visibly instead of silently deleting user-facing context.
 */
export function formatMessage(
  catalog: MessageCatalog,
  key: MessageKey,
  values: Readonly<Record<string, string | number>> = {},
): string {
  return catalog[key].replace(/\{([a-z][a-zA-Z0-9]*)\}/gu, (token, name) => {
    const replacement = values[name];
    return replacement === undefined ? token : String(replacement);
  });
}

/** Returns sorted catalog keys for deterministic completeness validation. */
export function messageCatalogKeys(catalog: MessageCatalog): string[] {
  return Object.keys(catalog).sort();
}
