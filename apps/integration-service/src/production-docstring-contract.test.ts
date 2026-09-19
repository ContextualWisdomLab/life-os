import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface MissingDocstring {
  readonly file: string;
  readonly line: number;
  readonly declaration: string;
}

interface DocstringVerificationReport {
  readonly productionFiles: number;
  readonly requiredDeclarations: number;
  readonly documentedDeclarations: number;
  readonly missing: readonly MissingDocstring[];
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

/** Collects production declarations and their missing documentation without evaluating source. */
function inspectDocstrings(
  source: ts.SourceFile,
  relativeFile: string,
): {
  readonly required: number;
  readonly missing: readonly MissingDocstring[];
} {
  const missing: MissingDocstring[] = [];
  let required = 0;

  const inspect = (node: ts.Node): void => {
    const isTopLevel = node.parent === source;
    const isClassMember =
      node.parent !== undefined &&
      (ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent));

    if (requiresDocstring(node) && (isTopLevel || isClassMember)) {
      required += 1;
      if (!hasDocstring(node)) {
        const { line } = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        );
        missing.push({
          file: relativeFile,
          line: line + 1,
          declaration: declarationName(node, source),
        });
      }
    }

    ts.forEachChild(node, inspect);
  };

  inspect(source);
  return { required, missing };
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

/** Retains only repository-relative declaration coordinates and aggregate counts for RCA. */
async function writeReport(report: DocstringVerificationReport): Promise<void> {
  const verificationDirectory = path.resolve(
    process.cwd(),
    '../..',
    '.verification',
  );
  await mkdir(verificationDirectory, { recursive: true });
  const serialized = `${JSON.stringify(report)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > 65_536) {
    throw new Error(
      'Docstring verification report exceeded the 65536-byte boundary',
    );
  }
  await writeFile(
    path.join(verificationDirectory, 'integration-docstrings.json'),
    serialized,
    { encoding: 'utf8', mode: 0o600 },
  );
}

describe('Integration production docstring contract', () => {
  it('documents every top-level and class-owned production declaration', async () => {
    const files = await productionSourceFiles();
    const missing: MissingDocstring[] = [];
    let requiredDeclarations = 0;

    for (const file of files) {
      const sourceText = await readFile(file, 'utf8');
      const relativeFile = path
        .relative(process.cwd(), file)
        .replaceAll('\\', '/');
      const source = ts.createSourceFile(
        relativeFile,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const inspected = inspectDocstrings(source, relativeFile);
      requiredDeclarations += inspected.required;
      missing.push(...inspected.missing);
    }

    await writeReport({
      productionFiles: files.length,
      requiredDeclarations,
      documentedDeclarations: requiredDeclarations - missing.length,
      missing,
    });
    expect(missing).toEqual([]);
  });
});
