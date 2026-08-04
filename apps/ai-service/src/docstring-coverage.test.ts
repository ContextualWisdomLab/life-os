import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** One production declaration missing an explanatory JSDoc block. */
interface UndocumentedDeclaration {
  readonly file: string;
  readonly line: number;
  readonly declaration: string;
}

/** Reports whether the declaration's leading trivia ends with one JSDoc block. */
function hasJSDoc(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const leadingTrivia = sourceFile.text.slice(
    node.getFullStart(),
    node.getStart(sourceFile),
  );
  return /\/\*\*[\s\S]*?\*\/\s*$/u.test(leadingTrivia);
}

/** Maps a callable variable declaration to the owning statement carrying JSDoc. */
function documentationOwner(node: ts.Node): ts.Node {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
  ) {
    return node.parent.parent;
  }
  return node;
}

/** Identifies callable variable or property initializers that require documentation. */
function hasCallableInitializer(
  node: ts.VariableDeclaration | ts.PropertyDeclaration,
): boolean {
  return (
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  );
}

/** Produces a stable human-readable name for a documentation failure. */
function declarationName(node: ts.Node): string {
  if (ts.isConstructorDeclaration(node)) {
    const parent = node.parent;
    return ts.isClassDeclaration(parent) && parent.name
      ? `${parent.name.text}.constructor`
      : 'constructor';
  }
  if (
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node)
  ) {
    return node.name?.getText() ?? node.kind.toString();
  }
  return node.kind.toString();
}

/** Identifies production declaration kinds that require explanatory JSDoc. */
function requiresJSDoc(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    (ts.isVariableDeclaration(node) && hasCallableInitializer(node)) ||
    (ts.isPropertyDeclaration(node) && hasCallableInitializer(node))
  );
}

/** Restricts the contract to top-level declarations and class/interface members. */
function isDocumentedScope(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const owner = documentationOwner(node);
  return (
    owner.parent === sourceFile ||
    ts.isClassDeclaration(node.parent) ||
    ts.isInterfaceDeclaration(node.parent)
  );
}

/** Collects every undocumented production declaration from one TypeScript source. */
function collectUndocumentedDeclarations(
  file: string,
  source: string,
): UndocumentedDeclaration[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const missing: UndocumentedDeclaration[] = [];

  /** Visits one syntax node and records any in-scope documentation failure. */
  function visit(node: ts.Node): void {
    if (
      requiresJSDoc(node) &&
      isDocumentedScope(node, sourceFile) &&
      !hasJSDoc(documentationOwner(node), sourceFile)
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      missing.push({
        file,
        line: position.line + 1,
        declaration: declarationName(node),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return missing;
}

/** Discovers production TypeScript sources while excluding all test fixtures. */
async function discoverSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return await discoverSourceFiles(path);
      }
      return entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts')
        ? [path]
        : [];
    }),
  );
  return files.flat().sort();
}

describe('ai-service source documentation', () => {
  it('documents every production declaration with JSDoc', async () => {
    const sourceFiles = await discoverSourceFiles(__dirname);
    const missing = (
      await Promise.all(
        sourceFiles.map(async (path) => {
          const source = await readFile(path, 'utf8');
          return collectUndocumentedDeclarations(path, source);
        }),
      )
    ).flat();

    expect(missing).toEqual([]);
  });
});
