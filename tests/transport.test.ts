import { EventEmitter } from 'node:events';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { ServiceMetadata } from '../src/core/ast-parser.js';
import { Logger } from '../src/core/logger.js';
import { Transport } from '../src/core/transport.js';

describe('Transport', () => {
  let transport: Transport;
  let serviceContainer: any;
  let mockStdin: EventEmitter;
  let writeSpy: any;

  beforeEach(() => {
    serviceContainer = {
      getAllToolsMetadata: jest.fn(),
      getToolName: jest.fn((service: ServiceMetadata, method: any) => {
        return method.toolName || `${service.className}_${method.name}`;
      }),
      getToolMetadata: jest.fn(),
      execute: jest.fn(),
    };

    transport = new Transport(serviceContainer);
    mockStdin = new EventEmitter() as any;
    (mockStdin as any).setEncoding = jest.fn();

    jest.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as any);
    writeSpy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
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

  describe('listen', () => {
    it('should handle initialize request', async () => {
      await transport.listen();

      mockStdin.emit(
        'data',
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          method: 'initialize',
          params: {},
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

      mockStdin.emit(
        'data',
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 'cfg',
          method: 'initialize',
          params: {},
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

      mockStdin.emit(
        'data',
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

      mockStdin.emit(
        'data',
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

      mockStdin.emit(
        'data',
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

      mockStdin.emit(
        'data',
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

      mockStdin.emit(
        'data',
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
      expect(response.result.content).toEqual([]);
      expect(response.result.structuredContent).toEqual({ result: 'success' });
    });

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

      mockStdin.emit(
        'data',
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

      mockStdin.emit(
        'data',
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

      mockStdin.emit(
        'data',
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

      mockStdin.emit(
        'data',
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
