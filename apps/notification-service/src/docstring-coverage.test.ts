import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const DOCUMENTED_SOURCE_FILES = [
  'notification-runtime.ts',
  'postgres-reminder-repository.ts',
  'reminder-scheduler.ts',
] as const;

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

/** Names one declaration precisely enough for an actionable failure message. */
function declarationName(node: ts.Node): string {
  if (ts.isConstructorDeclaration(node)) {
    const parent = node.parent;
    return ts.isClassDeclaration(parent) && parent.name
      ? `${parent.name.text}.constructor`
      : 'constructor';
  }
  if (
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

/** Selects declarations that require beginner-readable JSDoc coverage. */
function requiresJSDoc(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/** Collects every undocumented production declaration in one source file. */
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

describe('notification-service source documentation', () => {
  it('documents every production declaration with JSDoc', async () => {
    const missing = (
      await Promise.all(
        DOCUMENTED_SOURCE_FILES.map(async (file) => {
          const source = await readFile(resolve(__dirname, file), 'utf8');
          return collectUndocumentedDeclarations(file, source);
        }),
      )
    ).flat();

    expect(missing).toEqual([]);
  });
});
