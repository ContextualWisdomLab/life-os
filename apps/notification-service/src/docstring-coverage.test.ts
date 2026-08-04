import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface UndocumentedDeclaration {
  readonly file: string;
  readonly line: number;
  readonly declaration: string;
}

/** Returns whether a declaration has an immediately preceding JSDoc block. */
function hasJSDoc(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const leadingTrivia = sourceFile.text.slice(
    node.getFullStart(),
    node.getStart(sourceFile),
  );
  return /\/\*\*[\s\S]*?\*\/\s*$/u.test(leadingTrivia);
}

/** Returns whether a variable or property stores a named callable value. */
function hasCallableInitializer(
  node: ts.VariableDeclaration | ts.PropertyDeclaration,
): boolean {
  return (
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  );
}

/** Names one declaration precisely enough for an actionable failure message. */
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

/** Selects every named callable or structural declaration governed by JSDoc. */
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

/** Collects every undocumented named declaration in one TypeScript source. */
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

  /** Visits every syntax node while preserving exact source positions. */
  function visit(node: ts.Node): void {
    if (requiresJSDoc(node) && !hasJSDoc(node, sourceFile)) {
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

/** Discovers all notification-service TypeScript files deterministically. */
async function discoverSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return await discoverSourceFiles(path);
      }
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
    }),
  );
  return files.flat().sort();
}

describe('notification-service source documentation', () => {
  it('documents every named declaration with JSDoc', async () => {
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
