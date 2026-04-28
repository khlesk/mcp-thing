import * as path from 'node:path';
import type { ServiceMetadata } from '../src/core/ast-parser.js';
import { ServiceContainer } from '../src/core/service-container.js';

describe('ServiceContainer', () => {
  let container: ServiceContainer;
  const calculatorFileName = path.resolve(
    process.cwd(),
    'examples/CalculatorService.ts',
  );

  const mockMetadata: ServiceMetadata[] = [
    {
      className: 'CalculatorService',
      fileName: calculatorFileName,
      methods: [
        {
          name: 'add',
          description: 'Adds two numbers',
          parameters: [
            {
              name: 'a',
              type: 'number',
              description: 'First number',
              required: true,
            },
            {
              name: 'b',
              type: 'number',
              description: 'Second number',
              required: true,
            },
          ],
        },
        {
          name: 'greet',
          toolName: 'friendly-greeting',
          description: 'Greets a user',
          parameters: [
            {
              name: 'name',
              type: 'string',
              description: 'User name',
              required: true,
            },
            {
              name: 'greeting',
              type: 'string',
              description: 'Optional greeting',
              required: false,
            },
          ],
        },
      ],
    },
  ];

  beforeEach(() => {
    container = new ServiceContainer(mockMetadata);
  });

  describe('initialize', () => {
    it('should initialize and hold metadata', async () => {
      expect(container.getAllToolsMetadata()).toEqual(mockMetadata);
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      await container.initialize();
    });

    it('should execute a tool and return result', async () => {
      const result = await container.execute('CalculatorService_add', {
        a: 5,
        b: 3,
      });
      expect(result).toBe(8);
    });

    it('should handle optional parameters', async () => {
      const result = await container.execute('friendly-greeting', {
        name: 'World',
      });
      expect(result).toBe('Hello, World!');
    });

    it('should use provided optional parameter', async () => {
      const result = await container.execute('friendly-greeting', {
        name: 'World',
        greeting: 'Hi',
      });
      expect(result).toBe('Hi, World!');
    });

    it('should throw error for non-existent service/method', async () => {
      await expect(container.execute('NonExistent_math', {})).rejects.toThrow(
        'Tool NonExistent_math not found.',
      );
      await expect(
        container.execute('CalculatorService_unknown', {}),
      ).rejects.toThrow('Tool CalculatorService_unknown not found.');
    });
  });
});
