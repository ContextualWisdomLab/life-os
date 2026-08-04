#!/usr/bin/env python3
"""Apply review-driven notification tests and implementation in two phases."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps/notification-service/src"


def read(path: str) -> str:
    """Read one repository text file with stable UTF-8 handling."""
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    """Write one repository text file with a terminal newline."""
    target = ROOT / path
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    """Replace one exact reviewed fragment or fail closed if the source moved."""
    text = read(path)
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    write(path, text.replace(old, new, 1))


def replace_pattern_once(path: str, pattern: str, replacement: str) -> None:
    """Replace one reviewed regular-expression region or fail closed."""
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one pattern match in {path}, found {count}")
    write(path, updated)


def write_docstring_contract() -> None:
    """Limit JSDoc enforcement to production top-level declarations and members."""
    write(
        "apps/notification-service/src/docstring-coverage.test.ts",
        r'''import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

interface UndocumentedDeclaration {
  readonly file: string;
  readonly line: number;
  readonly declaration: string;
}

function hasJSDoc(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const leadingTrivia = sourceFile.text.slice(
    node.getFullStart(),
    node.getStart(sourceFile),
  );
  return /\/\*\*[\s\S]*?\*\/\s*$/u.test(leadingTrivia);
}

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

function hasCallableInitializer(
  node: ts.VariableDeclaration | ts.PropertyDeclaration,
): boolean {
  return (
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  );
}

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

function isDocumentedScope(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  const owner = documentationOwner(node);
  return (
    owner.parent === sourceFile ||
    ts.isClassDeclaration(node.parent) ||
    ts.isInterfaceDeclaration(node.parent)
  );
}

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

describe('notification-service source documentation', () => {
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
});''',
    )


def add_scheduler_review_tests() -> None:
    """Add scheduler isolation and deterministic claim-token evidence."""
    path = "apps/notification-service/src/reminder-scheduler.integration.test.ts"
    replace_once(
        path,
        """  readonly deliveredByWorkspaceDate = new Map<string, number>();

""",
        """  readonly deliveredByWorkspaceDate = new Map<string, number>();
  private claimSequence = 0;

""",
    )
    replace_once(
        path,
        """    const claimKey = `${occurrenceKey}:claim`;
    this.claims.set(occurrenceKey, claimKey);
""",
        """    this.claimSequence += 1;
    const claimKey = `${occurrenceKey}:claim:${this.claimSequence}`;
    this.claims.set(occurrenceKey, claimKey);
""",
    )
    replace_once(
        path,
        """type PersistenceOperation = 'defer' | 'fail' | 'markDelivered';
""",
        """type PersistenceOperation =
  | 'countDelivered'
  | 'defer'
  | 'fail'
  | 'markDelivered';
""",
    )
    replace_once(
        path,
        """  /** Atomically completes a fenced claim and records an immutable delivered outcome. */
  override async markDelivered(
""",
        """  /** Counts delivered outcomes or simulates one transient persistence failure. */
  override async countDelivered(
    workspaceId: string,
    date: string,
  ): Promise<number> {
    if (this.consumeFailure('countDelivered')) {
      throw new Error('persistence unavailable');
    }
    return await super.countDelivered(workspaceId, date);
  }

  /** Atomically completes a fenced claim and records an immutable delivered outcome. */
  override async markDelivered(
""",
    )
    replace_once(
        path,
        """  it('defers through a daylight-saving fallback until local quiet hours end', async () => {
""",
        """  it('creates a distinct opaque token for each released claim attempt', async () => {
    const value = reminder({ quietHours: null });
    const repository = new InMemoryReminderRepository([value]);
    const firstClaim = await repository.claim(
      value.workspaceId,
      value.id,
      value.dueAt,
      value.deliveryAttempt,
    );
    if (firstClaim === null) throw new Error('expected the first claim');
    await repository.defer(
      value,
      '2026-08-04T12:05:00.000Z',
      'quiet_hours',
      firstClaim,
      'first-delivery-key',
    );
    const secondClaim = await repository.claim(
      value.workspaceId,
      value.id,
      value.dueAt,
      value.deliveryAttempt,
    );

    expect(secondClaim).not.toBeNull();
    expect(secondClaim).not.toBe(firstClaim);
  });

  it('defers through a daylight-saving fallback until local quiet hours end', async () => {
""",
    )
    replace_once(
        path,
        """    const terminalRepository = new FailOnceReminderRepository(
""",
        """    const countRepository = new FailOnceReminderRepository(
      [reminder({ quietHours: null })],
      'countDelivered',
    );
    await expect(
      new ReminderScheduler(countRepository, new RecordingGateway()).run(
        new Date('2026-08-04T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ delivered: 0, persistenceFailures: 1 });

    const dailyLimitRepository = new FailOnceReminderRepository(
      [
        reminder({
          quietHours: null,
          maxPerLocalDay: 1,
        }),
      ],
      'defer',
    );
    dailyLimitRepository.deliveredByWorkspaceDate.set(
      `${workspaceAlpha}:2026-08-04`,
      1,
    );
    await expect(
      new ReminderScheduler(
        dailyLimitRepository,
        new RecordingGateway(),
      ).run(new Date('2026-08-04T12:00:00.000Z')),
    ).resolves.toMatchObject({ deferred: 0, persistenceFailures: 1 });

    const terminalRepository = new FailOnceReminderRepository(
""",
    )


def refine_repository_coverage_test() -> None:
    """Make SQL fixtures fail loudly and move scheduler-only evidence out."""
    path = "apps/notification-service/src/postgres-reminder-repository.coverage.test.ts"
    replace_once(
        path,
        """      const response = responses[index] ?? [];
      index += 1;
      if (response instanceof Error) {
""",
        """      const response = responses[index];
      if (response === undefined) {
        throw new Error(`unexpected query #${index + 1}: no response prepared`);
      }
      index += 1;
      if (response instanceof Error) {
""",
    )
    replace_pattern_once(
        path,
        r"\n  it\('isolates a daily-limit deferral persistence failure',[\s\S]*?\n  \}\);\n\}\);\s*$",
        "\n});\n",
    )
    text = read(path)
    text = text.replace("  ReminderScheduler,\n", "")
    text = re.sub(
        r"  /\*\* Represents the reminder delivery gateway values used by deterministic test fixtures\. \*/\n"
        r"  type ReminderDeliveryGateway,\n",
        "",
        text,
    )
    text = re.sub(
        r"  /\*\* Represents the reminder repository values used by deterministic test fixtures\. \*/\n"
        r"  type ReminderRepository,\n",
        "",
        text,
    )
    write(path, text)


def add_runtime_review_tests() -> None:
    """Add structured pool-error and concurrent shutdown regression tests."""
    path = "apps/notification-service/src/notification-runtime.test.ts"
    replace_once(
        path,
        """class FakeNotificationPool implements NotificationPool {
  endCalls = 0;
  readonly calls: Array<{
""",
        """class FakeNotificationPool implements NotificationPool {
  endCalls = 0;
  endBehavior: () => Promise<void> = async () => undefined;
  readonly calls: Array<{
""",
    )
    replace_once(
        path,
        """  async end(): Promise<void> {
    this.endCalls += 1;
  }
""",
        """  async end(): Promise<void> {
    this.endCalls += 1;
    await this.endBehavior();
  }
""",
    )
    replace_pattern_once(
        path,
        r"  it\('handles idle pool errors with one fixed credential-free record',[\s\S]*?\n  \}\);\n\n  it\('builds a bounded PostgreSQL pool configuration'",
        """  it('emits bounded credential-free pool error classifications', () => {
    let errorListener: ((error: Error) => void) | undefined;
    const source = {
      on(event: 'error', listener: (error: Error) => void): void {
        expect(event).toBe('error');
        errorListener = listener;
      },
    };
    const logged: unknown[][] = [];
    registerNotificationPoolErrorHandler(source, (...values: unknown[]) => {
      logged.push(values);
    });

    errorListener?.(
      Object.assign(
        new Error('postgresql://administrator:secret@database.example.test'),
        { name: 'DatabaseError', code: '57P01' },
      ),
    );
    errorListener?.(
      Object.assign(new Error('secret'), {
        name: 'bad\\nname',
        code: 'bad code',
      }),
    );
    errorListener?.(Object.assign(new Error('secret'), { code: 42 }));

    expect(logged).toEqual([
      [
        {
          message: 'Notification PostgreSQL pool reported an idle client error',
          context: 'NotificationRuntime',
          errorName: 'DatabaseError',
          postgresCode: '57P01',
        },
      ],
      [
        {
          message: 'Notification PostgreSQL pool reported an idle client error',
          context: 'NotificationRuntime',
          errorName: 'Error',
          postgresCode: null,
        },
      ],
      [
        {
          message: 'Notification PostgreSQL pool reported an idle client error',
          context: 'NotificationRuntime',
          errorName: 'Error',
          postgresCode: null,
        },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain('secret');
  });

  it('uses the Nest logger without serializing the database error', () => {
    let errorListener: ((error: Error) => void) | undefined;
    const source = {
      on(_event: 'error', listener: (error: Error) => void): void {
        errorListener = listener;
      },
    };
    const logger = vi
      .spyOn(Logger, 'error')
      .mockImplementation(() => undefined);

    registerNotificationPoolErrorHandler(source);
    errorListener?.(
      new Error('postgresql://administrator:secret@database.example.test'),
    );

    expect(logger).toHaveBeenCalledWith(
      {
        message: 'Notification PostgreSQL pool reported an idle client error',
        context: 'NotificationRuntime',
        errorName: 'Error',
        postgresCode: null,
      },
      'NotificationRuntime',
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret');
    logger.mockRestore();
  });

  it('builds a bounded PostgreSQL pool configuration'""",
    )
    replace_once(
        path,
        """      'Required notification configuration is missing: NOTIFICATION_DATABASE_URL',
    );
  });

  it('fails closed on non-integer or out-of-range pool configuration', () => {
""",
        """      'Notification configuration exceeds maximum length: NOTIFICATION_DATABASE_URL',
    );
  });

  it('fails closed on non-integer or out-of-range pool configuration', () => {
""",
    )
    replace_once(
        path,
        """  it('shares one pool across adapters and closes it exactly once', async () => {
""",
        """  it('shares one in-flight close promise across concurrent callers', async () => {
    const pool = new FakeNotificationPool();
    let releaseEnd: (() => void) | undefined;
    pool.endBehavior = () =>
      new Promise<void>((resolve) => {
        releaseEnd = resolve;
      });
    const runtime = createNotificationRuntime(
      { NOTIFICATION_DATABASE_URL: DATABASE_URL },
      () => pool,
    );

    const first = runtime.close();
    const second = runtime.onApplicationShutdown();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();

    expect(pool.endCalls).toBe(1);
    expect(secondSettled).toBe(false);
    releaseEnd?.();
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
  });

  it('allows a later close attempt to retry a rejected pool shutdown', async () => {
    const pool = new FakeNotificationPool();
    let failureAvailable = true;
    pool.endBehavior = async () => {
      if (failureAvailable) {
        failureAvailable = false;
        throw new Error('shutdown unavailable');
      }
    };
    const runtime = createNotificationRuntime(
      { NOTIFICATION_DATABASE_URL: DATABASE_URL },
      () => pool,
    );

    await expect(runtime.close()).rejects.toThrowError('shutdown unavailable');
    await expect(runtime.close()).resolves.toBeUndefined();
    expect(pool.endCalls).toBe(2);
  });

  it('shares one pool across adapters and closes it exactly once', async () => {
""",
    )


def apply_tests() -> None:
    """Apply regression tests before changing production behavior."""
    write_docstring_contract()
    add_scheduler_review_tests()
    refine_repository_coverage_test()
    add_runtime_review_tests()


def implement_runtime_repairs() -> None:
    """Implement sanitized pool telemetry, explicit configuration, and shutdown sharing."""
    path = "apps/notification-service/src/notification-runtime.ts"
    replace_pattern_once(
        path,
        r"/\*\* Credential-free error logger used by the pool error boundary\. \*/[\s\S]*?export function registerNotificationPoolErrorHandler\([\s\S]*?\n\}\n\n/\*\* PostgreSQL pool boundary",
        """/** Structured credential-free record emitted for one pool failure. */
export interface NotificationPoolErrorRecord {
  readonly message: string;
  readonly context: 'NotificationRuntime';
  readonly errorName: string;
  readonly postgresCode: string | null;
}

/** Credential-free error logger used by the pool error boundary. */
export type NotificationPoolErrorLogger = (
  record: NotificationPoolErrorRecord,
) => void;

const NOTIFICATION_POOL_ERROR_MESSAGE =
  'Notification PostgreSQL pool reported an idle client error';
const POOL_ERROR_CLASSIFICATION_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u;

/** Retains only bounded non-secret error classification tokens. */
function safePoolErrorClassification(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return POOL_ERROR_CLASSIFICATION_PATTERN.test(value) ? value : null;
}

/** Emits one structured record without serializing the database error. */
function defaultNotificationPoolErrorLogger(
  record: NotificationPoolErrorRecord,
): void {
  Logger.error(record, record.context);
}

/** Registers a sanitized listener before the PostgreSQL pool can be used. */
export function registerNotificationPoolErrorHandler(
  pool: NotificationPoolErrorSource,
  logError: NotificationPoolErrorLogger = defaultNotificationPoolErrorLogger,
): void {
  pool.on('error', (error) => {
    const code = (error as { code?: unknown }).code;
    logError({
      message: NOTIFICATION_POOL_ERROR_MESSAGE,
      context: 'NotificationRuntime',
      errorName: safePoolErrorClassification(error.name) ?? 'Error',
      postgresCode: safePoolErrorClassification(code),
    });
  });
}

/** PostgreSQL pool boundary""",
    )
    replace_once(
        path,
        """  const value = environment[name]?.trim();
  if (!value || value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Required notification configuration is missing: ${name}`);
  }
  return value;
""",
        """  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Required notification configuration is missing: ${name}`);
  }
  if (value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Notification configuration exceeds maximum length: ${name}`);
  }
  return value;
""",
    )
    replace_once(
        path,
        """    connectionString: requireDatabaseUrl(
      /** Performs the require configuration operation while preserving tenant-safe bounded behavior. */
      requireConfiguration(environment, 'NOTIFICATION_DATABASE_URL'),
    ),
""",
        """    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'NOTIFICATION_DATABASE_URL'),
    ),
""",
    )
    replace_once(
        path,
        """  const pool = new Pool(configuration);
  /** Performs the register notification pool error handler operation while preserving bounded, tenant-safe notification behavior. */
  registerNotificationPoolErrorHandler(pool);
""",
        """  const pool = new Pool(configuration);
  registerNotificationPoolErrorHandler(pool);
""",
    )
    replace_once(
        path,
        """export class NotificationRuntime implements OnApplicationShutdown {
  private closed = false;
""",
        """export class NotificationRuntime implements OnApplicationShutdown {
  private closing: Promise<void> | undefined;
""",
    )
    replace_once(
        path,
        """  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
  }
""",
        """  async close(): Promise<void> {
    if (this.closing === undefined) {
      this.closing = this.pool.end().catch((error: unknown) => {
        this.closing = undefined;
        throw error;
      });
    }
    await this.closing;
  }
""",
    )


def implement_scheduler_repairs() -> None:
    """Isolate delivery-count persistence failures and remove expression noise."""
    path = "apps/notification-service/src/reminder-scheduler.ts"
    replace_once(
        path,
        """      if (
        quietHours !== null &&
        /** Performs the is within quiet hours operation while preserving tenant-safe bounded behavior. */
        isWithinQuietHours(clock.minuteOfDay, quietHours)
      ) {
""",
        """      if (
        quietHours !== null &&
        isWithinQuietHours(clock.minuteOfDay, quietHours)
      ) {
""",
    )
    replace_once(
        path,
        """      const deliveredToday = await this.repository.countDelivered(
        reminder.workspaceId,
        clock.localDate,
      );
""",
        """      let deliveredToday: number;
      try {
        deliveredToday = await this.repository.countDelivered(
          reminder.workspaceId,
          clock.localDate,
        );
      } catch {
        persistenceFailures += 1;
        continue;
      }
""",
    )
    replace_once(
        path,
        """            reminder,
            /** Performs the retry instant operation while preserving tenant-safe bounded behavior. */
            retryInstant(now, reminder.deliveryAttempt),
""",
        """            reminder,
            retryInstant(now, reminder.deliveryAttempt),
""",
    )


def remove_generated_test_noise() -> None:
    """Remove low-information comments that were generated solely for test declarations."""
    patterns = (
        re.compile(
            r"^[ \t]*/\*\* Supports .*? test scenario without hiding production behavior\. \*/\n",
            re.M,
        ),
        re.compile(
            r"^[ \t]*/\*\* Represents .*? values used by deterministic test fixtures\. \*/\n",
            re.M,
        ),
    )
    for path in sorted(SOURCE.glob("*.test.ts")):
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            text = pattern.sub("", text)
        path.write_text(text, encoding="utf-8")


def apply_implementation() -> None:
    """Apply production fixes after the new tests have demonstrated failures."""
    implement_runtime_repairs()
    implement_scheduler_repairs()
    remove_generated_test_noise()


def main() -> None:
    """Run the requested tests or implementation phase."""
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("tests", "implementation"))
    arguments = parser.parse_args()
    if arguments.phase == "tests":
        apply_tests()
    else:
        apply_implementation()


if __name__ == "__main__":
    main()
