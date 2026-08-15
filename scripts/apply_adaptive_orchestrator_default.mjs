#!/usr/bin/env node
/** Apply the adaptive contextual-orchestrator request policy to LifeOS. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expectedBranch = 'agent/adaptive-orchestrator-default';
const branch = process.env.GITHUB_REF_NAME ?? expectedBranch;
if (branch !== expectedBranch) {
  throw new Error(`refusing to mutate unexpected branch: ${branch}`);
}

function replaceOnce(text, oldText, newText, label) {
  const parts = text.split(oldText);
  if (parts.length !== 2) {
    throw new Error(`${label}: expected one match, found ${parts.length - 1}`);
  }
  return `${parts[0]}${newText}${parts[1]}`;
}

const sourcePath = resolve(
  root,
  'apps/ai-service/src/contextual-orchestrator-proposal-model.ts',
);
let source = readFileSync(sourcePath, 'utf8');
source = replaceOnce(
  source,
  '/** Builds one immutable no-tools OpenAI-compatible structured-output request. */',
  '/** Builds one immutable no-tools adaptive-orchestration request. */',
  'request documentation',
);
source = replaceOnce(
  source,
  "    model: 'contextual-orchestrator',\n    temperature: 0,",
  "    model: 'contextual-orchestrator',\n    orchestration_mode: 'auto',\n    temperature: 0,",
  'adaptive mode field',
);
source = replaceOnce(
  source,
  `    response_format: {\n      type: 'json_schema',\n      json_schema: {\n        name: 'life_os_inert_proposal_draft',\n        strict: true,\n        schema: CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA,\n      },\n    },\n`,
  '',
  'provider-native response format',
);
writeFileSync(sourcePath, source);

const testPath = resolve(
  root,
  'apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts',
);
let tests = readFileSync(testPath, 'utf8');
tests = replaceOnce(
  tests,
  `  ContextualOrchestratorProposalModel,\n  createContextualOrchestratorConfiguration,`,
  `  ContextualOrchestratorProposalModel,\n  CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA,\n  createContextualOrchestratorConfiguration,`,
  'schema import',
);
tests = replaceOnce(
  tests,
  "  it('sends a no-tools schema-constrained request and returns untrusted output', async () => {",
  "  it('sends an adaptive no-tools request and returns untrusted output', async () => {",
  'test name',
);
tests = replaceOnce(
  tests,
  `    expect(body.model).toBe('contextual-orchestrator');\n    expect(body.tools).toBeUndefined();`,
  `    expect(body.model).toBe('contextual-orchestrator');\n    expect(body.orchestration_mode).toBe('auto');\n    expect(body.tools).toBeUndefined();\n    expect(body.response_format).toBeUndefined();`,
  'request assertions',
);
tests = replaceOnce(
  tests,
  `    const responseFormat = body.response_format as Record<string, unknown>;\n    expect(responseFormat.type).toBe('json_schema');\n    const jsonSchema = responseFormat.json_schema as Record<string, unknown>;\n    expect(jsonSchema.name).toBe('life_os_inert_proposal_draft');\n    expect(jsonSchema.strict).toBe(true);\n    const schema = jsonSchema.schema as Record<string, unknown>;\n`,
  `    const schema = CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA as Record<string, unknown>;\n`,
  'local schema assertions',
);
writeFileSync(testPath, tests);

const changelogPath = resolve(root, 'CHANGELOG.md');
let changelog = readFileSync(changelogPath, 'utf8');
changelog = replaceOnce(
  changelog,
  '## Unreleased\n\n### Added\n',
  '## Unreleased\n\n### Changed\n\n- LifeOS proposal generation now explicitly requests contextual-orchestrator `auto` mode and keeps its strict proposal schema in the LifeOS validation boundary instead of sending provider-native `response_format`, allowing the orchestrator to choose the least-cost quality-sufficient route, verification, or conducted workflow.\n\n### Added\n',
  'changelog',
);
writeFileSync(changelogPath, changelog);

const adrPath = resolve(
  root,
  'docs/adr/0003-adaptive-contextual-orchestrator-default.md',
);
if (existsSync(adrPath)) {
  throw new Error(`refusing to replace existing ADR: ${adrPath}`);
}
writeFileSync(
  adrPath,
  `# ADR-0003: LifeOS delegates proposal execution depth to contextual-orchestrator\n\n- Status: Accepted\n- Date: 2026-08-15\n\n## Context\n\nThe proposal adapter sent a provider-native JSON Schema response format. The contextual-orchestrator compatibility boundary must pass such requests through one selected provider model because multi-step answers cannot safely be merged into an arbitrary provider response envelope. That transport feature therefore disabled adaptive orchestration even though LifeOS independently treats model output as untrusted and validates every proposal before persistence or user confirmation.\n\n## Decision\n\nLifeOS sends \\`orchestration_mode: "auto"\\`, omits provider-native \\`response_format\\`, preserves the JSON-only system instruction, and retains the versioned strict schema in the local proposal validation boundary.\n\n- contextual-orchestrator owns model, provider, reasoning effort, verification, workflow depth, and known-cost selection;\n- LifeOS owns the inert proposal contract, strict validation, authorization, persistence, confirmation, and execution boundary;\n- no model output mutates user state;\n- explicit route/conduct modes remain only in the live evaluation harness for controlled ablation.\n\n## Consequences\n\nThe response envelope remains OpenAI-compatible, but the model content is parsed and validated locally rather than trusted because an upstream provider claimed schema conformance. The actual orchestration trace can vary by task, so quality and cost evidence must be taken from contextual-orchestrator telemetry.\n\n## References\n\nOmidvar, H., & Akhlaghi, V. (2026). *A communication-theoretic framework for LLM agents: Cost-aware adaptive reliability* [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2605.09121\n\nTang, Y., Cetin, E., Xu, J., Sun, Q., Nielsen, S., Richard, V., Goda, H., Tymchenko, I., Nguyen, N., Lee, H., Ashiga, M., Kotyan, S., Kuroki, S., & Clanuwat, T. (2026). *Sakana Fugu technical report* [Technical report]. arXiv. https://doi.org/10.48550/arXiv.2606.21228\n`,
  'utf8',
);
