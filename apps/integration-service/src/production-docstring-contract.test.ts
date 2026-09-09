import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface MissingDocstring {
  readonly file: string;
  readonly line: number;
  readonly declaration: string;
}

/** Returns true only when a declaration owns an actual JSDoc comment. */
function hasDocstring(node: ts.Node): boolean {
  return ts
    .getJSDocCommentsAndTags(node)
    .some((entry) => entry.kind === ts.SyntaxKind.JSDocComment);
}

/** Produces a stable human-readable declaration name without evaluating source. */
function declarationName(node: ts.Node, source: ts.SourceFile): string {
  if ('name' in node) {
    const name = (node as { readonly name?: ts.Node }).name;
    if (name !== undefined) {
      return name.getText(source);
    }
  }
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  return ts.SyntaxKind[node.kind] ?? 'unknown';
}

/** Identifies top-level and class-owned production declarations that require documentation. */
function requiresDocstring(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Collects undocumented named production declarations while ignoring nested implementation callbacks. */
function missingDocstrings(
  source: ts.SourceFile,
  relativeFile: string,
): readonly MissingDocstring[] {
  const missing: MissingDocstring[] = [];

  const inspect = (node: ts.Node): void => {
    const isTopLevel = node.parent === source;
    const isClassMember =
      node.parent !== undefined &&
      (ts.isClassDeclaration(node.parent) ||
        ts.isClassExpression(node.parent));

    if (
      requiresDocstring(node) &&
      (isTopLevel || isClassMember) &&
      !hasDocstring(node)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      missing.push({
        file: relativeFile,
        line: line + 1,
        declaration: declarationName(node, source),
      });
    }

    ts.forEachChild(node, inspect);
  };

  inspect(source);
  return missing;
}

/** Enumerates the same Integration-owned TypeScript production source denominator used by V8 coverage. */
async function productionSourceFiles(): Promise<readonly string[]> {
  const sourceDirectory = path.resolve(process.cwd(), 'src');
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts'),
    )
    .map((entry) => path.join(sourceDirectory, entry.name))
    .sort();
}

describe('Integration production docstring contract', () => {
  it('documents every top-level and class-owned production declaration', async () => {
    const files = await productionSourceFiles();
    const missing: MissingDocstring[] = [];

    for (const file of files) {
      const sourceText = await readFile(file, 'utf8');
      const relativeFile = path.relative(process.cwd(), file).replaceAll('\\', '/');
      const source = ts.createSourceFile(
        relativeFile,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      missing.push(...missingDocstrings(source, relativeFile));
    }

    expect(missing).toEqual([]);
  });
});
