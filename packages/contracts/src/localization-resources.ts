/** Versioned shared contract for published LifeOS product translation resources. */
export const LOCALIZATION_RESOURCE_CONTRACT_VERSION =
  'life-os.localization-resource.v1' as const;

/** Product locales supported by the canonical translation-resource contract. */
export const PRODUCT_LOCALES = [
  'ko',
  'en',
  'ja',
  'zh',
  'vi',
  'es',
  'de',
  'fr',
] as const;

/** Locale codes that may identify one published product translation resource. */
export type ProductLocale = (typeof PRODUCT_LOCALES)[number];

/**
 * Requests one exact published screen resource.
 *
 * User/workspace authority is intentionally absent: caller authentication and
 * durable locale preference belong to their owning contexts, not product
 * translation-resource identity.
 */
export interface LocalizationResourceRequest {
  readonly contractVersion: typeof LOCALIZATION_RESOURCE_CONTRACT_VERSION;
  readonly locale: ProductLocale;
  readonly screenKey: string;
  readonly resourceVersionId: string;
}

/**
 * Immutable published translation evidence for one locale and screen version.
 * Ontology labels are excluded because semantic label truth has a separate owner.
 */
export interface LocalizationResourceResponse {
  readonly contractVersion: typeof LOCALIZATION_RESOURCE_CONTRACT_VERSION;
  readonly locale: ProductLocale;
  readonly screenKey: string;
  readonly resourceVersionId: string;
  readonly resourceDigestSha256: string;
  readonly entries: Readonly<Record<string, string>>;
}
