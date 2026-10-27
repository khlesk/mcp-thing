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
    path.resolve('tests/fixtures/ArrayService.ts'),
  ],
  cwd: process.cwd(),
  stderr: 'pipe' as const,
};

const toolName = 'ArrayService_extractArticles';
const urls = ['https://example.com/one', 'https://example.com/two'];

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

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([toolName]);
      const result = await client.callTool({
        name: toolName,
        arguments: { urls },
      });
      expect(result.structuredContent).toEqual({ result: urls });
      expect(result.content).toEqual([]);
      expect(result.isError).not.toBe(true);
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
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([toolName]);
      const result = await client.callTool({
        name: toolName,
        arguments: { urls },
      });
      expect(result.structuredContent).toEqual({ result: urls });
      expect(result.content).toEqual([]);
      expect(result.isError).not.toBe(true);
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
