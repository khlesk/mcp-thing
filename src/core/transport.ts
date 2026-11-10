import {
  type CallToolResult,
  Server,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Tool,
} from '@modelcontextprotocol/server';
import {
  type StdioServerHandle,
  serveStdio,
} from '@modelcontextprotocol/server/stdio';
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
  private handle?: StdioServerHandle;
  private schemaBuilder: SchemaBuilder;
  private serviceContainer: ServiceContainer;
  private serverInfo: ServerInfo;
  private logger: Logger;
  private resultMode: ResultMode;

  constructor(
    serviceContainer: ServiceContainer,
    options: TransportOptions = {},
  ) {
    this.schemaBuilder = new SchemaBuilder(options.logger);
    this.serviceContainer = serviceContainer;
    this.serverInfo = mergeServerInfo(DEFAULT_SERVER_INFO, options.serverInfo);
    this.logger = options.logger || new Logger();
    this.resultMode = options.resultMode || 'structured';
  }

  private createServer(): Server {
    const server = new Server(this.serverInfo, {
      supportedProtocolVersions: ['2026-07-28', ...SUPPORTED_PROTOCOL_VERSIONS],
      capabilities: { tools: {} },
      cacheHints: {
        'tools/list': { ttlMs: 60_000, cacheScope: 'private' },
      },
    });

    server.setRequestHandler('tools/list', async () => {
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
            ...(method.annotations ? { annotations: method.annotations } : {}),
            inputSchema: this.schemaBuilder.buildInputSchema(
              method,
            ) as Tool['inputSchema'],
            ...(outputSchema
              ? {
                  outputSchema: outputSchema as Tool['outputSchema'],
                }
              : {}),
          });
        }
      }

      tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { tools };
    });

    // MCP tools/call
    server.setRequestHandler('tools/call', async ({ params }) => {
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
    });

    return server;
  }

  public async listen(): Promise<void> {
    if (this.handle) throw new Error('Transport is already listening.');
    this.handle = serveStdio(() => this.createServer(), {
      onerror: (error) => this.logger.error('MCP transport error:', error),
    });
    this.logger.started(this.getExportedToolNames());
  }

  public async close(): Promise<void> {
    await this.handle?.close();
    this.handle = undefined;
  }

  private normalizeToolResult(
    result: unknown,
    resultMode: ResultMode,
  ): CallToolResult {
    if (this.isToolResult(result)) {
      return {
        ...result,
        content:
          result.content?.length || !result.structuredContent
            ? result.content || []
            : [
                {
                  type: 'text',
                  text: this.toTextContent(result.structuredContent),
                },
              ],
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

    const structuredContent = this.toStructuredContent(result);
    return {
      content: [{ type: 'text', text: this.toTextContent(structuredContent) }],
      structuredContent,
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
