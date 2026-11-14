import { PassThrough } from 'node:stream';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  SERVER_INFO_META_KEY,
} from '@modelcontextprotocol/server';
import type { ServiceMetadata } from '../src/core/ast-parser.js';
import { Logger } from '../src/core/logger.js';
import { Transport } from '../src/core/transport.js';

describe('Transport', () => {
  let transport: Transport;
  let serviceContainer: any;
  let mockStdin: PassThrough;
  let writeSpy: any;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    serviceContainer = {
      getAllToolsMetadata: jest.fn(),
      getToolName: jest.fn((service: ServiceMetadata, method: any) => {
        return method.toolName || `${service.className}_${method.name}`;
      }),
      getToolMetadata: jest.fn(),
      execute: jest.fn(),
    };

    transport = new Transport(serviceContainer);
    mockStdin = new PassThrough();

    jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(async () => {
    await transport.close();
    jest.restoreAllMocks();
  });

  const getJsonResponse = () => {
    for (const call of writeSpy.mock.calls) {
      const text = call[0];
      if (text.trim().startsWith('{')) {
        return JSON.parse(text);
      }
    }
    return null;
  };

  const modernMeta = {
    [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
    [CLIENT_INFO_META_KEY]: { name: 'test-client', version: '1.0.0' },
    [CLIENT_CAPABILITIES_META_KEY]: {},
  };

  const sendRequest = async (method: string, params: unknown) => {
    writeSpy.mockClear();
    mockStdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })}\n`,
    );
    await new Promise((resolve) => setImmediate(resolve));
    return getJsonResponse();
  };

  describe('listen', () => {
    it.each([
      ['2025-11-25', '2025-11-25'],
      ['2025-06-18', '2025-06-18'],
      ['2025-03-26', '2025-03-26'],
      ['2024-11-05', '2024-11-05'],
      ['2024-10-07', '2024-10-07'],
      ['1900-01-01', '2025-11-25'],
    ])('negotiates legacy version %s as %s', async (requested, expected) => {
      await transport.listen();
      const response = await sendRequest('initialize', {
        protocolVersion: requested,
        capabilities: {},
        clientInfo: { name: 'old-client', version: '1.0.0' },
      });
      expect(response.result.protocolVersion).toBe(expected);
      expect(response.result.capabilities.tools).toEqual({});
      expect(response.result._meta).toBeUndefined();
    });

    it('handles discovery without initialization and identifies the server', async () => {
      await transport.listen();
      const response = await sendRequest('server/discover', {
        _meta: modernMeta,
      });
      expect(response.result.supportedVersions).toContain('2026-07-28');
      expect(response.result.capabilities.tools).toEqual({});
      expect(response.result._meta[SERVER_INFO_META_KEY]).toEqual({
        name: 'Reflection-Based MCP Server',
        version: '1.0.0',
      });
      expect(response.result.ttlMs).toBe(0);
      expect(response.result.cacheScope).toBe('private');
    });

    it('calls tools directly without discovery or initialization', async () => {
      serviceContainer.execute.mockResolvedValue([
        'article one',
        'article two',
      ]);
      await transport.listen();
      const response = await sendRequest('tools/call', {
        name: 'readability',
        arguments: { urls: ['https://example.com'] },
        _meta: modernMeta,
      });
      expect(serviceContainer.execute).toHaveBeenCalledWith('readability', {
        urls: ['https://example.com'],
      });
      expect(response.result.structuredContent).toEqual({
        result: ['article one', 'article two'],
      });
      expect(response.result.ttlMs).toBeUndefined();
      expect(response.result.cacheScope).toBeUndefined();
      expect(response.result.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify(response.result.structuredContent, null, 2),
        },
      ]);
    });

    it('rejects unsupported modern versions and accepts a corrected request', async () => {
      serviceContainer.execute.mockResolvedValue('success');
      await transport.listen();
      const response = await sendRequest('tools/call', {
        name: 'readability',
        _meta: { ...modernMeta, [PROTOCOL_VERSION_META_KEY]: '2099-01-01' },
      });
      expect(response.error.code).toBe(-32022);
      expect(response.error.data).toMatchObject({
        requested: '2099-01-01',
        supported: expect.arrayContaining(['2026-07-28']),
      });
      expect(serviceContainer.execute).not.toHaveBeenCalled();
      const retry = await sendRequest('tools/call', {
        name: 'readability',
        _meta: modernMeta,
      });
      expect(retry.result.structuredContent).toEqual({ result: 'success' });
    });

    it('validates metadata on every modern request', async () => {
      serviceContainer.execute.mockResolvedValue('success');
      await transport.listen();
      await sendRequest('tools/call', {
        name: 'readability',
        _meta: modernMeta,
      });
      serviceContainer.execute.mockClear();
      const response = await sendRequest('tools/call', {
        name: 'readability',
        _meta: { ...modernMeta, [CLIENT_INFO_META_KEY]: 'invalid' },
      });
      expect(response.error.code).toBe(-32602);
      expect(serviceContainer.execute).not.toHaveBeenCalled();
    });

    it('buffers fragmented messages and processes multiple lines', async () => {
      serviceContainer.execute.mockResolvedValue('success');
      await transport.listen();
      const request = `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'readability', _meta: modernMeta },
      })}\n`;
      mockStdin.write(request.slice(0, 20));
      await new Promise((resolve) => setImmediate(resolve));
      expect(writeSpy).not.toHaveBeenCalled();
      mockStdin.write(request.slice(20) + request.replace('"id":1', '"id":2'));
      await new Promise((resolve) => setImmediate(resolve));
      const responses = writeSpy.mock.calls.map(([line]: [string]) =>
        JSON.parse(line),
      );
      expect(responses.map((response: any) => response.id).sort()).toEqual([
        1, 2,
      ]);
      expect(serviceContainer.execute).toHaveBeenCalledTimes(2);
    });

    it('writes invalid-message diagnostics to stderr and recovers', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      await transport.listen();
      mockStdin.write('{"jsonrpc":"invalid"}\n');
      await new Promise((resolve) => setImmediate(resolve));
      expect(writeSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        '[mcp-thing] MCP transport error:',
        expect.any(Error),
      );
      const response = await sendRequest('server/discover', {
        _meta: modernMeta,
      });
      expect(response.result.supportedVersions).toContain('2026-07-28');
    });

    it('should handle initialize request', async () => {
      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.id).toBe('1');
      expect(response.result.protocolVersion).toBe('2024-11-05');
    });

    it('should return configured serverInfo in initialize result', async () => {
      transport = new Transport(serviceContainer, {
        serverInfo: { name: 'Test Server', version: '9.9.9' },
      });
      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 'cfg',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.id).toBe('cfg');
      expect(response.result.serverInfo).toEqual({
        name: 'Test Server',
        version: '9.9.9',
      });
    });

    it.each([
      { names: [], expected: [] },
      {
        names: ['zebra', 'Alpha', 'alpha'],
        expected: ['Alpha', 'alpha', 'zebra'],
      },
    ])(
      'returns private 60-second cache hints and stable tool ordering for $names',
      async ({ names, expected }) => {
        const metadata: ServiceMetadata[] = [
          {
            className: 'TestService',
            fileName: 'test.ts',
            methods: names.map((name) => ({
              name,
              toolName: name,
              description: '',
              parameters: [],
            })),
          },
        ];
        serviceContainer.getAllToolsMetadata.mockReturnValue(metadata);
        await transport.listen();

        const first = await sendRequest('tools/list', { _meta: modernMeta });
        expect(first.result).toMatchObject({
          resultType: 'complete',
          ttlMs: 60_000,
          cacheScope: 'private',
        });
        expect(
          first.result.tools.map((tool: { name: string }) => tool.name),
        ).toEqual(expected);

        metadata[0].methods.reverse();
        const second = await sendRequest('tools/list', { _meta: modernMeta });
        expect(second.result).toEqual(first.result);
      },
    );

    it('should handle tools/list request', async () => {
      const mockMeta: ServiceMetadata[] = [
        {
          className: 'TestService',
          fileName: 'test.ts',
          methods: [
            {
              name: 'testMethod',
              toolName: 'custom-test-tool',
              description: 'A test method',
              parameters: [],
            },
          ],
        },
      ];
      serviceContainer.getAllToolsMetadata.mockReturnValue(mockMeta);

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.id).toBe(2);
      expect(response.result.tools[0].name).toBe('custom-test-tool');
      expect(response.result.ttlMs).toBeUndefined();
      expect(response.result.cacheScope).toBeUndefined();
    });

    it('should expose array parameter schemas in tools/list', async () => {
      const mockMeta: ServiceMetadata[] = [
        {
          className: 'ArticleService',
          fileName: 'test.ts',
          methods: [
            {
              name: 'extractArticles',
              description: 'Extracts article text',
              returnType: '{ articles: string[]; }',
              parameters: [
                {
                  name: 'urls',
                  description: 'Article URLs',
                  type: 'string[]',
                  required: true,
                },
              ],
            },
          ],
        },
      ];
      serviceContainer.getAllToolsMetadata.mockReturnValue(mockMeta);

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 22,
          method: 'tools/list',
          params: {},
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.id).toBe(22);
      expect(response.result.tools[0].inputSchema.properties.urls).toEqual({
        type: 'array',
        items: { type: 'string' },
        description: 'Article URLs',
      });
      expect(response.result.tools[0].outputSchema).toEqual({
        type: 'object',
        properties: {
          articles: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['articles'],
      });
    });

    it('should not expose output schemas for content-mode tools', async () => {
      const mockMeta: ServiceMetadata[] = [
        {
          className: 'ArticleService',
          fileName: 'test.ts',
          methods: [
            {
              name: 'extractArticles',
              description: 'Extracts article text',
              resultMode: 'content',
              returnType: '{ articles: string[]; }',
              parameters: [],
            },
          ],
        },
      ];
      serviceContainer.getAllToolsMetadata.mockReturnValue(mockMeta);

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 23,
          method: 'tools/list',
          params: {},
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.result.tools[0].outputSchema).toBeUndefined();
    });

    it('should not expose output schemas when global content mode is configured', async () => {
      const mockMeta: ServiceMetadata[] = [
        {
          className: 'ArticleService',
          fileName: 'test.ts',
          methods: [
            {
              name: 'extractArticles',
              description: 'Extracts article text',
              returnType: '{ articles: string[]; }',
              parameters: [],
            },
          ],
        },
      ];
      serviceContainer.getAllToolsMetadata.mockReturnValue(mockMeta);
      transport = new Transport(serviceContainer, { resultMode: 'content' });

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 24,
          method: 'tools/list',
          params: {},
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.result.tools[0].outputSchema).toBeUndefined();
    });

    it('should return structured content by default', async () => {
      serviceContainer.execute.mockResolvedValue('success');
      serviceContainer.getToolMetadata.mockReturnValue(undefined);

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'TestService_testMethod',
            arguments: { a: 1 },
          },
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.id).toBe(3);
      expect(response.result.content).toEqual([
        {
          type: 'text',
          text: JSON.stringify(response.result.structuredContent, null, 2),
        },
      ]);
      expect(response.result.structuredContent).toEqual({ result: 'success' });
    });

    it.each([
      [
        'object',
        { title: 'Article', text: 'Article body' },
        { title: 'Article', text: 'Article body' },
      ],
      ['empty input', [], { result: [] }],
      ['number', 42, { result: 42 }],
      ['boolean', false, { result: false }],
      ['null', null, { result: null }],
      ['undefined', undefined, {}],
      [
        'mixed URL outcomes',
        [
          {
            url: 'https://example.com/article',
            title: 'Article',
            text: 'Article body',
          },
          { url: 'https://example.com/missing', error: 'Article not found' },
        ],
        {
          result: [
            {
              url: 'https://example.com/article',
              title: 'Article',
              text: 'Article body',
            },
            { url: 'https://example.com/missing', error: 'Article not found' },
          ],
        },
      ],
    ])(
      'returns matching text and structured data for %s',
      async (_label, value, expected) => {
        serviceContainer.execute.mockResolvedValue(value);
        await transport.listen();
        const response = await sendRequest('tools/call', {
          name: 'readability',
          arguments: { urls: [] },
          _meta: modernMeta,
        });
        expect(response.result.structuredContent).toEqual(expected);
        expect(response.result.content).toEqual([
          { type: 'text', text: JSON.stringify(expected, null, 2) },
        ]);
        expect(JSON.parse(response.result.content[0].text)).toEqual(expected);
      },
    );

    it.each([undefined, []])(
      'adds text to an explicit structured result with content %p',
      async (content) => {
        const structuredContent = { result: [{ error: 'Article not found' }] };
        serviceContainer.execute.mockResolvedValue({
          structuredContent,
          content,
          _meta: { source: 'extractor' },
        });
        await transport.listen();
        const response = await sendRequest('tools/call', {
          name: 'readability',
          _meta: modernMeta,
        });
        expect(response.result).toMatchObject({
          structuredContent,
          content: [
            { type: 'text', text: JSON.stringify(structuredContent, null, 2) },
          ],
          _meta: { source: 'extractor' },
        });
      },
    );

    it('should support per-tool content mode', async () => {
      serviceContainer.execute.mockResolvedValue({ ok: true });
      serviceContainer.getToolMetadata.mockReturnValue({
        service: { className: 'TestService', fileName: 'test.ts', methods: [] },
        method: {
          name: 'testMethod',
          description: 'A test method',
          resultMode: 'content',
          parameters: [],
        },
      });

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 33,
          method: 'tools/call',
          params: {
            name: 'TestService_testMethod',
            arguments: { a: 1 },
          },
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.id).toBe(33);
      expect(response.result.content[0].text).toBe(
        JSON.stringify({ ok: true }, null, 2),
      );
      expect(response.result.structuredContent).toBeUndefined();
    });

    it('should return valid text content for undefined in content mode', async () => {
      serviceContainer.execute.mockResolvedValue(undefined);
      serviceContainer.getToolMetadata.mockReturnValue({
        service: { className: 'TestService', fileName: 'test.ts', methods: [] },
        method: {
          name: 'testMethod',
          description: 'A test method',
          resultMode: 'content',
          parameters: [],
        },
      });

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 36,
          method: 'tools/call',
          params: {
            name: 'TestService_testMethod',
            arguments: {},
          },
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.result.content).toEqual([{ type: 'text', text: '' }]);
    });

    it('should pass through explicit tool results', async () => {
      serviceContainer.execute.mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'Partial failure' }],
        structuredContent: { failed: 2 },
      });

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 34,
          method: 'tools/call',
          params: {
            name: 'TestService_testMethod',
            arguments: {},
          },
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.result).toEqual({
        isError: true,
        content: [{ type: 'text', text: 'Partial failure' }],
        structuredContent: { failed: 2 },
      });
    });

    it('should return text content for thrown tool errors', async () => {
      serviceContainer.execute.mockRejectedValue(new Error('Bad request'));

      await transport.listen();

      mockStdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 35,
          method: 'tools/call',
          params: {
            name: 'TestService_testMethod',
            arguments: {},
          },
        })}\n`,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = getJsonResponse();
      expect(response).not.toBeNull();
      expect(response.result).toEqual({
        isError: true,
        content: [{ type: 'text', text: 'Bad request' }],
      });
    });

    it('should log startup with exported tool names', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const mockMeta: ServiceMetadata[] = [
        {
          className: 'TestService',
          fileName: 'test.ts',
          methods: [
            {
              name: 'testMethod',
              toolName: 'custom-test-tool',
              description: 'A test method',
              parameters: [],
            },
          ],
        },
      ];
      serviceContainer.getAllToolsMetadata.mockReturnValue(mockMeta);

      await transport.listen();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('custom-test-tool'),
      );
    });

    it('should suppress startup log in silent mode', async () => {
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      transport = new Transport(serviceContainer, {
        logger: new Logger({ silent: true }),
      });

      await transport.listen();

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
