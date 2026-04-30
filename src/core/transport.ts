import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCServer } from 'json-rpc-2.0';
import type { ResultMode } from './ast-parser.js';
import { Logger } from './logger.js';
import { SchemaBuilder } from './schema-builder.js';
import {
  DEFAULT_SERVER_INFO,
  mergeServerInfo,
  type ServerInfo,
} from './server-info.js';
import type { ServiceContainer } from './service-container.js';

type TextContent = {
  type: 'text';
  text: string;
};

export interface ToolResult {
  content?: TextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface TransportOptions {
  serverInfo?: Partial<ServerInfo>;
  logger?: Logger;
  resultMode?: ResultMode;
}

export class Transport {
  private server: JSONRPCServer;
  private schemaBuilder: SchemaBuilder;
  private serviceContainer: ServiceContainer;
  private serverInfo: ServerInfo;
  private logger: Logger;
  private resultMode: ResultMode;

  constructor(
    serviceContainer: ServiceContainer,
    options: TransportOptions = {},
  ) {
    this.server = new JSONRPCServer();
    this.schemaBuilder = new SchemaBuilder(options.logger);
    this.serviceContainer = serviceContainer;
    this.serverInfo = mergeServerInfo(DEFAULT_SERVER_INFO, options.serverInfo);
    this.logger = options.logger || new Logger();
    this.resultMode = options.resultMode || 'structured';
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
          const resultMode = method.resultMode || this.resultMode;
          const outputSchema =
            resultMode === 'structured'
              ? this.schemaBuilder.buildOutputSchema(method)
              : undefined;
          tools.push({
            name: this.serviceContainer.getToolName(service, method),
            description: method.description,
            inputSchema: this.schemaBuilder.buildInputSchema(method) as {
              type: 'object';
              properties: Record<string, object>;
              required?: string[];
            },
            ...(outputSchema
              ? {
                  outputSchema: outputSchema as {
                    type: 'object';
                    properties?: Record<string, object>;
                    required?: string[];
                  },
                }
              : {}),
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
          const metadata = this.serviceContainer.getToolMetadata?.(name);
          const resultMode =
            metadata?.method.resultMode || this.resultMode || 'structured';

          return this.normalizeToolResult(result, resultMode);
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

  private normalizeToolResult(
    result: unknown,
    resultMode: ResultMode,
  ): ToolResult {
    if (this.isToolResult(result)) {
      return {
        ...result,
        content: result.content || [],
      };
    }

    if (resultMode === 'content') {
      return {
        content: [
          {
            type: 'text',
            text: this.toTextContent(result),
          },
        ],
      };
    }

    return {
      content: [],
      structuredContent: this.toStructuredContent(result),
    };
  }

  private isToolResult(result: unknown): result is ToolResult {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return false;
    }

    return (
      'content' in result ||
      'structuredContent' in result ||
      'isError' in result
    );
  }

  private toStructuredContent(result: unknown): Record<string, unknown> {
    if (result === undefined) return {};

    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }

    return { result };
  }

  private toTextContent(result: unknown): string {
    if (typeof result === 'string') return result;
    if (result === undefined) return '';
    return JSON.stringify(result, null, 2);
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
