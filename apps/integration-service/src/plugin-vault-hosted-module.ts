import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PluginOperatorApplication } from './plugin-operator-application';
import {
  PluginVaultHostedRuntimeError,
  type PluginVaultHostedRuntime,
} from './plugin-vault-hosted-runtime';
import { IntegrationAppModule } from './main';

/** Host-runtime token retained so Nest shutdown owns the same accepted runtime authority it serves. */
export const PLUGIN_VAULT_HOSTED_RUNTIME = Symbol(
  'life-os.integration.plugin-vault-hosted-runtime',
);

/** Closes the service-owned PostgreSQL runtime when the Nest application shuts down. */
@Injectable()
class PluginVaultHostedRuntimeShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(PLUGIN_VAULT_HOSTED_RUNTIME)
    private readonly runtime: PluginVaultHostedRuntime,
  ) {}

  /** Delegates shutdown to the runtime's concurrency-safe idempotent close boundary. */
  async onApplicationShutdown(): Promise<void> {
    await this.runtime.close();
  }
}

@Module({})
class PluginVaultHostedModule {}

/** Captures one stable runtime authority surface before it enters Nest dependency injection. */
function requireRuntime(value: unknown): PluginVaultHostedRuntime {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginVaultHostedRuntimeError();
  }

  let operator: unknown;
  let close: unknown;
  try {
    operator = (value as PluginVaultHostedRuntime).operator;
    close = (value as PluginVaultHostedRuntime).close;
  } catch {
    throw new PluginVaultHostedRuntimeError();
  }
  if (
    !(operator instanceof PluginOperatorApplication) ||
    typeof close !== 'function'
  ) {
    throw new PluginVaultHostedRuntimeError();
  }

  const receiver = value as object;
  return Object.freeze({
    operator,
    close(): Promise<void> {
      return Reflect.apply(close, receiver, []) as Promise<void>;
    },
  });
}

/**
 * Registers one already-composed Plugin runtime before a Nest listener can start.
 *
 * The Integration module receives only the runtime's authenticated operator. Pool
 * ownership remains attached to the enclosing hosted module, whose shutdown hook
 * closes the accepted runtime authority. Runtime properties are captured once before
 * registration so throwing or stateful accessors cannot replace operator/shutdown
 * authority after the dependency has crossed the composition boundary.
 *
 * Only the concrete `PluginOperatorApplication` produced by the Integration-owned
 * authenticated composition may cross this boundary. An object-shaped impostor is
 * rejected before Nest registration and can never defer a missing-method failure to
 * the first operator request after the listener has already started.
 */
export function createPluginVaultHostedModule(
  runtimeInput: PluginVaultHostedRuntime,
): DynamicModule {
  const runtime = requireRuntime(runtimeInput);

  return {
    module: PluginVaultHostedModule,
    imports: [IntegrationAppModule.withPluginOperator(runtime.operator)],
    providers: [
      { provide: PLUGIN_VAULT_HOSTED_RUNTIME, useValue: runtime },
      PluginVaultHostedRuntimeShutdown,
    ],
  };
}
