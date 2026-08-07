import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = resolve(__dirname);

/** Recursively lists production TypeScript files in stable path order. */
function productionFiles(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      return statSync(path).isDirectory() ? productionFiles(path) : [path];
    })
    .filter(
      (path) =>
        path.endsWith('.ts') &&
        !path.endsWith('.test.ts') &&
        !path.endsWith('.d.ts'),
    )
    .sort();
}

/** Returns whether one declaration is exported from its source module. */
function isExported(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

/** Returns whether one declaration has a non-empty JSDoc block. */
function hasDocumentation(node: ts.Node): boolean {
  return ts
    .getJSDocCommentsAndTags(node)
    .some((item) => item.getText().startsWith('/**'));
}

/** Produces a stable human-readable declaration identifier. */
function declarationName(node: ts.Node, file: string): string {
  const named = node as ts.Node & { readonly name?: ts.Node };
  const name = named.name?.getText() ?? ts.SyntaxKind[node.kind];
  const position = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());
  return `${relative(SOURCE_ROOT, file)}:${position.line + 1}:${name}`;
}

/** Collects every exported API declaration and public class member. */
function documentedSurface(file: string): Array<{ node: ts.Node; label: string }> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const result: Array<{ node: ts.Node; label: string }> = [];
  for (const statement of source.statements) {
    if (
      isExported(statement) &&
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isVariableStatement(statement))
    ) {
      result.push({
        node: statement,
        label: declarationName(statement, file),
      });
    }
    if (ts.isClassDeclaration(statement) && isExported(statement)) {
      for (const member of statement.members) {
        if (
          (ts.isConstructorDeclaration(member) ||
            ts.isMethodDeclaration(member) ||
            ts.isGetAccessorDeclaration(member) ||
            ts.isSetAccessorDeclaration(member)) &&
          !ts
            .getModifiers(member)
            ?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword,
            )
        ) {
          result.push({
            node: member,
            label: declarationName(member, file),
          });
        }
      }
    }
  }
  return result;
}

describe('privacy-service public documentation coverage', () => {
  it('documents every exported production declaration and public class member', () => {
    const declarations = productionFiles(SOURCE_ROOT).flatMap(documentedSurface);
    expect(declarations.length).toBeGreaterThan(20);
    const undocumented = declarations
      .filter(({ node }) => !hasDocumentation(node))
      .map(({ label }) => label);
    expect(undocumented).toEqual([]);
  });
});
