import {
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  PluginVaultHostedRuntimeError,
  type PluginVaultHostedRuntime,
} from './plugin-vault-hosted-runtime';
import { IntegrationAppModule } from './main';

/** Host-runtime token retained so Nest shutdown owns the same runtime it serves. */
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

/**
 * Registers one already-composed Plugin runtime before a Nest listener can start.
 *
 * The Integration module receives only the runtime's authenticated operator. Pool
 * ownership remains attached to the enclosing hosted module, whose shutdown hook
 * closes that exact runtime. This keeps controller authority and resource lifecycle
 * in one composition root without making controllers persistence owners.
 */
export function createPluginVaultHostedModule(
  runtime: PluginVaultHostedRuntime,
): DynamicModule {
  if (
    runtime === null ||
    typeof runtime !== 'object' ||
    runtime.operator === null ||
    typeof runtime.operator !== 'object' ||
    typeof runtime.close !== 'function'
  ) {
    throw new PluginVaultHostedRuntimeError();
  }

  return {
    module: PluginVaultHostedModule,
    imports: [IntegrationAppModule.withPluginOperator(runtime.operator)],
    providers: [
      { provide: PLUGIN_VAULT_HOSTED_RUNTIME, useValue: runtime },
      PluginVaultHostedRuntimeShutdown,
    ],
  };
}
