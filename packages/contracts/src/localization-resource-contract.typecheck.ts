import {
  LOCALIZATION_RESOURCE_CONTRACT_VERSION,
  PRODUCT_LOCALES,
  type LocalizationResourceRequest,
  type LocalizationResourceResponse,
} from './localization-resources.js';

const RESOURCE_VERSION_ID = '11111111-1111-4111-8111-111111111111';

/** The public product locale set is fixed by the LifeOS buyer contract. */
const expectedLocales = [
  'ko',
  'en',
  'ja',
  'zh',
  'vi',
  'es',
  'de',
  'fr',
] as const satisfies typeof PRODUCT_LOCALES;

/** A cache read is bound to one screen, locale, and exact published version. */
const request: LocalizationResourceRequest = {
  contractVersion: LOCALIZATION_RESOURCE_CONTRACT_VERSION,
  locale: 'ja',
  screenKey: 'today.workspace',
  resourceVersionId: RESOURCE_VERSION_ID,
};

/** Translation resources are product evidence; workspace identity stays outside this resource contract. */
const tenantCoupledRequest: LocalizationResourceRequest = {
  ...request,
  // @ts-expect-error workspace authority belongs to authenticated caller/preference context, not translation-resource identity.
  workspaceId: '22222222-2222-4222-8222-222222222222',
};

/** Published resource evidence is exact-versioned and digest-bound. */
const response: LocalizationResourceResponse = {
  contractVersion: LOCALIZATION_RESOURCE_CONTRACT_VERSION,
  locale: 'ja',
  screenKey: 'today.workspace',
  resourceVersionId: RESOURCE_VERSION_ID,
  resourceDigestSha256: 'a'.repeat(64),
  entries: Object.freeze({
    todayDate: '今日 · {date}',
    completedCountLabel: '{count} 件のアクションを完了',
  }),
};

// @ts-expect-error ontology labels are owned by a separate semantic ledger.
response.ontologyLabels = Object.freeze({ goal: '目標' });

const staleVersionRequest: LocalizationResourceRequest = {
  ...request,
  // @ts-expect-error resource version authority is mandatory; cache reads cannot mean "latest" implicitly.
  resourceVersionId: undefined,
};

const unsupportedLocaleRequest: LocalizationResourceRequest = {
  ...request,
  // @ts-expect-error product locales are allowlisted and versioned explicitly.
  locale: 'it',
};

const ambiguousResponse: LocalizationResourceResponse = {
  ...response,
  // @ts-expect-error published resources require an exact digest for cache/provenance validation.
  resourceDigestSha256: undefined,
};

void expectedLocales;
void tenantCoupledRequest;
void staleVersionRequest;
void unsupportedLocaleRequest;
void ambiguousResponse;
