import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCServer } from 'json-rpc-2.0';
import { Logger } from './logger.js';
import { SchemaBuilder } from './schema-builder.js';
import {
  DEFAULT_SERVER_INFO,
  mergeServerInfo,
  type ServerInfo,
} from './server-info.js';
import type { ServiceContainer } from './service-container.js';

export interface TransportOptions {
  serverInfo?: Partial<ServerInfo>;
  logger?: Logger;
}

export class Transport {
  private server: JSONRPCServer;
  private schemaBuilder: SchemaBuilder;
  private serviceContainer: ServiceContainer;
  private serverInfo: ServerInfo;
  private logger: Logger;

  constructor(
    serviceContainer: ServiceContainer,
    options: TransportOptions = {},
  ) {
    this.server = new JSONRPCServer();
    this.schemaBuilder = new SchemaBuilder();
    this.serviceContainer = serviceContainer;
    this.serverInfo = mergeServerInfo(DEFAULT_SERVER_INFO, options.serverInfo);
    this.logger = options.logger || new Logger();
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // MCP Initialize
    this.server.addMethod('initialize', async (_request: unknown) => {
      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: true,
          },
        },
        serverInfo: this.serverInfo,
      };
    });

    // MCP tools/list
    this.server.addMethod('tools/list', async () => {
      const services = this.serviceContainer.getAllToolsMetadata();
      const tools: Tool[] = [];

      for (const service of services) {
        for (const method of service.methods) {
          tools.push({
            name: this.serviceContainer.getToolName(service, method),
            description: method.description,
            inputSchema: this.schemaBuilder.buildInputSchema(method) as {
              type: 'object';
              properties: Record<string, object>;
              required?: string[];
            },
          });
        }
      }

      return { tools };
    });

    // MCP tools/call
    this.server.addMethod(
      'tools/call',
      async (params: { name: string; arguments?: Record<string, unknown> }) => {
        try {
          const { name, arguments: args } = params;
          const result = await this.serviceContainer.execute(name, args || {});

          return {
            content: [
              {
                type: 'text',
                text:
                  typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error: unknown) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text:
                  error instanceof Error
                    ? error.message
                    : 'Unknown error occurred during tool execution.',
              },
            ],
          };
        }
      },
    );

    // Fallback for notifications
    this.server.addMethod('notifications/initialized', () => null);
  }

  public async listen(): Promise<void> {
    process.stdin.setEncoding('utf8');

    let buffer = '';
    process.stdin.on('data', async (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line);
          const response = await this.server.receive(request);
          if (response) {
            process.stdout.write(`${JSON.stringify(response)}\n`);
          }
        } catch (err: unknown) {
          this.logger.error(
            `Error processing JSON-RPC line: ${line} ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });

    this.logger.started(this.getExportedToolNames());
  }

  private getExportedToolNames(): string[] {
    const services = this.serviceContainer.getAllToolsMetadata();
    if (!Array.isArray(services)) return [];
    const toolNames: string[] = [];

    for (const service of services) {
      for (const method of service.methods) {
        toolNames.push(this.serviceContainer.getToolName(service, method));
      }
    }

    return toolNames;
  }
}
