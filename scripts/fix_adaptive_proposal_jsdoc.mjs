#!/usr/bin/env node
/** Apply the bounded CodeRabbit JSDoc correction for adaptive proposal routing. */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'apps/ai-service/src/contextual-orchestrator-proposal-model.ts';
const source = readFileSync(path, 'utf8');
const oldText = '/** Builds one immutable no-tools OpenAI-compatible structured-output request. */';
const newText = `/**
 * Builds one immutable no-tools adaptive orchestration request.
 *
 * \`auto\` delegates model/provider choice, workflow depth, verification,
 * fallback, and known-price optimization to contextual-orchestrator. Trace
 * disclosure stays private by default, and provider-native \`response_format\`
 * is deliberately omitted because the gateway proxies that feature to one
 * worker instead of applying adaptive orchestration. LifeOS still validates
 * every returned proposal through its strict local domain contract.
 */`;
const matches = source.split(oldText).length - 1;
if (matches !== 1) {
  throw new Error(`expected one requestBody JSDoc match, found ${matches}`);
}
writeFileSync(path, source.replace(oldText, newText), 'utf8');
