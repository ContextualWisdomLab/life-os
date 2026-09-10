import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as ts from 'typescript';

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function hasJSDoc(node, sourceFile) {
  const leadingTrivia = sourceFile.text.slice(
    node.getFullStart(),
    node.getStart(sourceFile),
  );
  return /\/\*\*[\s\S]*?\*\/\s*$/u.test(leadingTrivia);
}

function documentationOwner(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
  ) {
    return node.parent.parent;
  }
  return node;
}

function hasCallableInitializer(node) {
  return (
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  );
}

function requiresJSDoc(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    (ts.isVariableDeclaration(node) && hasCallableInitializer(node)) ||
    (ts.isPropertyDeclaration(node) && hasCallableInitializer(node))
  );
}

function isProductionDeclarationScope(node, sourceFile) {
  const owner = documentationOwner(node);
  return owner.parent === sourceFile || ts.isClassDeclaration(node.parent);
}

function declarationName(node) {
  if (ts.isConstructorDeclaration(node)) {
    return ts.isClassDeclaration(node.parent) && node.parent.name
      ? `${node.parent.name.text}.constructor`
      : 'constructor';
  }
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    return node.name?.getText() ?? ts.SyntaxKind[node.kind];
  }
  return ts.SyntaxKind[node.kind];
}

function collectDocumentationEvidence(file, source) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declarations = [];

  function visit(node) {
    if (requiresJSDoc(node) && isProductionDeclarationScope(node, sourceFile)) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      declarations.push({
        file,
        line: position.line + 1,
        declaration: declarationName(node),
        documented: hasJSDoc(documentationOwner(node), sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return declarations;
}

async function discoverProductionSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.mjs') &&
        !entry.name.endsWith('.test.mjs'),
    )
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

test('docstring ownership requires an adjacent JSDoc block', () => {
  const source = `/** unrelated note */\nconst marker = 1;\nfunction undocumented() {}\n/** Explains the callable contract. */\nconst documented = () => true;\n`;
  const evidence = collectDocumentationEvidence('fixture.mjs', source);
  assert.deepEqual(
    evidence.map(({ declaration, documented }) => ({
      declaration,
      documented,
    })),
    [
      { declaration: 'undocumented', documented: false },
      { declaration: 'documented', documented: true },
    ],
  );
});

test('every Commercial Readiness production declaration has explanatory JSDoc', async () => {
  const sourceFiles = await discoverProductionSources(SOURCE_DIRECTORY);
  assert.ok(
    sourceFiles.length > 0,
    'Commercial Readiness production surface is empty',
  );

  const evidence = (
    await Promise.all(
      sourceFiles.map(async (path) =>
        collectDocumentationEvidence(path, await readFile(path, 'utf8')),
      ),
    )
  ).flat();
  const missing = evidence.filter((item) => !item.documented);
  const documented = evidence.length - missing.length;
  const coverage =
    evidence.length === 0 ? 100 : (documented / evidence.length) * 100;

  assert.equal(
    missing.length,
    0,
    `Commercial Readiness production docstring coverage ${documented}/${evidence.length} (${coverage.toFixed(2)}%); missing:\n${missing
      .map((item) => `${item.file}:${item.line} ${item.declaration}`)
      .join('\n')}`,
  );
  console.log(
    `Commercial Readiness production docstring coverage: ${documented}/${evidence.length} (100.00%)`,
  );
});
