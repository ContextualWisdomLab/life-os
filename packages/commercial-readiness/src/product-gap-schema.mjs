const REGISTRY_SCHEMA = 'life-os.product-gap-registry.v1';
const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const MAXIMUM_PRODUCT_GAPS = 100;

function invalidRegistry(detail = '') {
  throw new Error(
    `Invalid product gap registry${detail ? `: ${detail}` : ''}`,
  );
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Validates the deterministic mapping from a buyer outcome to its one canonical
 * open/closed GitHub issue identity. Issue prose and labels are never policy.
 */
export function validateProductGapRegistry(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).some((key) => key !== 'schema' && key !== 'gaps') ||
    value.schema !== REGISTRY_SCHEMA ||
    !Array.isArray(value.gaps) ||
    value.gaps.length > MAXIMUM_PRODUCT_GAPS
  ) {
    invalidRegistry();
  }

  const capabilityIds = new Set();
  const issueNumbers = new Set();
  const gaps = value.gaps.map((entry) => {
    if (
      !isPlainObject(entry) ||
      Object.keys(entry).some(
        (key) => key !== 'capability_id' && key !== 'tracking_issue',
      ) ||
      typeof entry.capability_id !== 'string' ||
      !CAPABILITY_ID_PATTERN.test(entry.capability_id) ||
      !Number.isSafeInteger(entry.tracking_issue) ||
      entry.tracking_issue <= 0 ||
      capabilityIds.has(entry.capability_id) ||
      issueNumbers.has(entry.tracking_issue)
    ) {
      invalidRegistry('invalid or duplicate gap mapping');
    }
    capabilityIds.add(entry.capability_id);
    issueNumbers.add(entry.tracking_issue);
    return Object.freeze({
      capability_id: entry.capability_id,
      tracking_issue: entry.tracking_issue,
    });
  });

  return Object.freeze({
    schema: REGISTRY_SCHEMA,
    gaps: Object.freeze(gaps),
  });
}
