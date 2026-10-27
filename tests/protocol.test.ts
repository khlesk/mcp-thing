import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as LegacyStdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverParameters = {
  command: process.execPath,
  args: [
    '--import',
    'tsx',
    path.resolve('src/cli.ts'),
    '--server-name',
    'Protocol Test Server',
    '--server-version',
    '2.0.0',
    path.resolve('tests/fixtures/ReadabilityService.ts'),
  ],
  cwd: process.cwd(),
  stderr: 'pipe' as const,
};

const toolName = 'readability';
const articleUrl = 'https://example.com/article';
const missingUrl = 'https://example.com/missing';

async function verifyResponses(client: Client | LegacyClient) {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name)).toEqual([toolName]);
  expect(tools[0].outputSchema).toMatchObject({
    type: 'object',
    properties: {
      result: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            text: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['url'],
        },
      },
    },
    required: ['result'],
  });

  const article = {
    url: articleUrl,
    title: 'Example article',
    text: 'Article body',
  };
  const failure = { url: missingUrl, error: 'Article not found' };
  for (const [urls, expected] of [
    [[articleUrl], [article]],
    [
      [articleUrl, missingUrl],
      [article, failure],
    ],
    [[], []],
  ] as const) {
    const result = await client.callTool({
      name: toolName,
      arguments: { urls },
    });
    expect(result.structuredContent).toEqual({ result: expected });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ result: expected }, null, 2) },
    ]);
    expect(result.isError).not.toBe(true);
  }

  const error = await client.callTool({
    name: toolName,
    arguments: { urls: ['tool-error'] },
  });
  expect(error.isError).toBe(true);
  expect(error.content).toEqual([{ type: 'text', text: 'Extraction failed' }]);
  expect(error.structuredContent).toBeUndefined();
}

describe('MCP client compatibility', () => {
  it('supports discovery and tool calls with the current SDK client', async () => {
    const client = new Client(
      { name: 'modern-test-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StdioClientTransport(serverParameters);
    let diagnostics = '';
    transport.stderr?.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    const errors: Error[] = [];
    client.onerror = (error) => errors.push(error);

    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe('modern');
      expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      const discovery = await client.discover();
      expect(discovery.supportedVersions).toContain('2026-07-28');
      expect(discovery.capabilities.tools).toEqual({});
      expect(client.getServerVersion()).toEqual({
        name: 'Protocol Test Server',
        version: '2.0.0',
      });

      await verifyResponses(client);
      expect(errors).toEqual([]);
      expect(diagnostics).toContain('Started MCP server on stdio');
    } catch (error) {
      throw new Error(`Modern client failed. Server stderr:\n${diagnostics}`, {
        cause: error,
      });
    } finally {
      await client.close();
    }
  });

  it('initializes and calls tools with the legacy SDK client', async () => {
    const client = new LegacyClient({
      name: 'legacy-test-client',
      version: '1.0.0',
    });
    const transport = new LegacyStdioClientTransport(serverParameters);
    let diagnostics = '';
    transport.stderr?.on('data', (chunk) => {
      diagnostics += chunk.toString();
    });
    const errors: Error[] = [];
    client.onerror = (error) => errors.push(error);

    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toEqual({
        name: 'Protocol Test Server',
        version: '2.0.0',
      });
      await verifyResponses(client);
      expect(errors).toEqual([]);
    } catch (error) {
      throw new Error(`Legacy client failed. Server stderr:\n${diagnostics}`, {
        cause: error,
      });
    } finally {
      await client.close();
    }
  });
});
