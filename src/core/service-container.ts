import path from 'node:path';
import type { MethodMetadata, ServiceMetadata } from './ast-parser.js';
import { Logger } from './logger.js';

export class ServiceContainer {
  private serviceInstances: Map<string, object> = new Map();
  private serviceMetadata: ServiceMetadata[] = [];
  private logger: Logger;

  constructor(metadata: ServiceMetadata[], logger: Logger = new Logger()) {
    this.serviceMetadata = metadata;
    this.logger = logger;
  }

  public async initialize(): Promise<void> {
    for (const meta of this.serviceMetadata) {
      try {
        // Dynamically import the service file.
        // Works with tsx loader at runtime and pure node for compiled JS.
        let filePath = meta.fileName;

        // Ensure absolute path and handle Windows file:// protocol
        if (!filePath.startsWith('file://')) {
          const absolutePath = path.resolve(filePath).replace(/\\/g, '/');
          filePath = `file://${absolutePath.startsWith('/') ? '' : '/'}${absolutePath}`;
        }

        this.logger.info(`Importing service from: ${filePath}`);
        const module = await import(filePath);
        const ServiceClass = module[meta.className];

        if (ServiceClass) {
          this.serviceInstances.set(meta.className, new ServiceClass());
          this.logger.info(`Initialized service: ${meta.className}`);
        } else {
          this.logger.warn(
            `Could not find class ${meta.className} in ${meta.fileName}. Available exports: ${Object.keys(module).join(', ')}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to initialize service ${meta.className} from ${meta.fileName}:`,
          error,
        );
      }
    }
  }

  public async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const resolvedTool = this.findToolByName(toolName);
    if (!resolvedTool) {
      throw new Error(`Tool ${toolName} not found.`);
    }

    const { service, method } = resolvedTool;
    const className = service.className;
    const methodName = method.name;
    const instance = this.serviceInstances.get(className);
    if (!instance) {
      throw new Error(`Service instance for ${className} not found.`);
    }

    if (
      typeof (instance as Record<string, unknown>)[methodName] !== 'function'
    ) {
      throw new Error(
        `Method ${methodName} not found on service ${className}.`,
      );
    }

    // We can optionally use the metadata here to ensure argument ordering match
    // But if the client sends keys correctly, and we use named mapping:
    // Most modern JS calls by object are fine if we use the spread or individual keys.
    // However, TS methods aren't usually called by "object", but by positional args.
    // We'll map the args to positional if needed by looking up the metadata.
    const orderedArgs = method.parameters.map((p) => args[p.name]);
    return await (instance as Record<string, (...args: unknown[]) => unknown>)[
      methodName
    ](...orderedArgs);
  }

  public getAllToolsMetadata(): ServiceMetadata[] {
    return this.serviceMetadata;
  }

  public getToolName(service: ServiceMetadata, method: MethodMetadata): string {
    return method.toolName || `${service.className}_${method.name}`;
  }

  private findToolByName(
    toolName: string,
  ): { service: ServiceMetadata; method: MethodMetadata } | undefined {
    for (const service of this.serviceMetadata) {
      for (const method of service.methods) {
        if (this.getToolName(service, method) === toolName) {
          return { service, method };
        }
      }
    }

    return undefined;
  }
}
