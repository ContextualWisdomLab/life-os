import { describe, expect, it } from 'vitest';
import * as publicSurface from './index.mjs';

const EXPECTED_EXPORTS = [
  'COMMERCIAL_DEVELOPMENT_POLICY_SCHEMA',
  'COMMERCIAL_DEVELOPMENT_PROMPT_SCHEMA',
  'COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA',
  'COMMERCIAL_DEVELOPMENT_RUN_SCHEMA',
  'CommercialDevelopmentContractError',
  'CommercialDevelopmentDiffError',
  'CommercialDevelopmentPromptError',
  'CommercialDevelopmentReceiptError',
  'CommercialDevelopmentSelectionError',
  'buildCommercialDevelopmentPrompt',
  'createCommercialDevelopmentReceipt',
  'normalizeCommercialDevelopmentPolicy',
  'selectCommercialDevelopmentIssue',
  'serializeCommercialDevelopmentReceipt',
  'validateCommercialDevelopmentDiff',
  'validateCommercialDevelopmentIssue',
  'validateCommercialDevelopmentReceipt',
  'validateCommercialDevelopmentRun',
];

describe('commercial development package public surface', () => {
  it('exports only the reviewed deterministic contracts', () => {
    expect(Object.keys(publicSurface).sort()).toEqual(EXPECTED_EXPORTS.sort());
  });
});
