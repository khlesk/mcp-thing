import path from 'node:path';
import { AstParser } from '../src/core/ast-parser';

describe('AstParser', () => {
  let parser: AstParser;
  const tsconfigPath = path.resolve(process.cwd(), 'tsconfig.json');

  beforeEach(() => {
    parser = new AstParser(tsconfigPath);
  });

  describe('parseServiceFiles', () => {
    it('should extract metadata from CalculatorService', () => {
      const result = parser.parseServiceFiles('examples');

      const calculatorService = result.find(
        (s) => s.className === 'CalculatorService',
      );
      expect(calculatorService).toBeDefined();
      expect(calculatorService?.className).toBe('CalculatorService');

      const addMethod = calculatorService?.methods.find(
        (m) => m.name === 'add',
      );
      expect(addMethod).toBeDefined();
      expect(addMethod?.parameters).toHaveLength(2);
      expect(addMethod?.parameters[0].name).toBe('a');
      expect(addMethod?.parameters[0].type).toBe('number');
    });

    it('should extract JSDoc comments for descriptions', () => {
      const result = parser.parseServiceFiles('examples');
      const calculatorService = result.find(
        (s) => s.className === 'CalculatorService',
      );
      const addMethod = calculatorService?.methods.find(
        (m) => m.name === 'add',
      );

      expect(addMethod?.description).toBe('Adds two numbers');
      expect(addMethod?.parameters[0].description).toBe('First number');
    });

    it('should extract custom tool names from method JSDoc tags', () => {
      const result = parser.parseServiceFiles('examples');
      const calculatorService = result.find(
        (s) => s.className === 'CalculatorService',
      );
      const greetMethod = calculatorService?.methods.find(
        (m) => m.name === 'greet',
      );

      expect(greetMethod?.toolName).toBe('friendly-greeting');
    });

    it('should ignore private methods', () => {
      const result = parser.parseServiceFiles('examples');
      const calculatorService = result.find(
        (s) => s.className === 'CalculatorService',
      );
      const privateMethod = calculatorService?.methods.find(
        (m) => m.name === 'privateMethod',
      );

      expect(privateMethod).toBeUndefined();
    });

    it('should preserve array parameter types', () => {
      const result = parser.parseServiceFiles('tests/fixtures');
      const arrayService = result.find((s) => s.className === 'ArrayService');
      const extractMethod = arrayService?.methods.find(
        (m) => m.name === 'extractArticles',
      );

      expect(extractMethod).toBeDefined();
      expect(extractMethod?.parameters).toHaveLength(1);
      expect(extractMethod?.parameters[0].name).toBe('urls');
      expect(extractMethod?.parameters[0].type).toBe('string[]');
    });

    it('should support tool ignores, constraints, result mode, and return types', () => {
      const result = parser.parseServiceFiles('tests/fixtures');

      expect(
        result.find((s) => s.className === 'IgnoredService'),
      ).toBeUndefined();
      expect(
        result.find((s) => s.className === 'EmptyService'),
      ).toBeUndefined();

      const advancedService = result.find(
        (s) => s.className === 'AdvancedService',
      );
      expect(advancedService).toBeDefined();
      expect(
        advancedService?.methods.find((m) => m.name === 'ignoredMethod'),
      ).toBeUndefined();

      const searchMethod = advancedService?.methods.find(
        (m) => m.name === 'search',
      );
      expect(searchMethod?.returnType).toBe(
        '{ packages: string[]; total: number; }',
      );
      expect(searchMethod?.parameters[0].constraints).toEqual({
        minLength: 2,
      });
      expect(searchMethod?.parameters[1].required).toBe(false);
      expect(searchMethod?.parameters[1].constraints).toEqual({
        default: 'name',
      });
      expect(searchMethod?.parameters[2].required).toBe(false);
      expect(searchMethod?.parameters[2].constraints).toEqual({
        minimum: 1,
        maximum: 500,
        default: 50,
      });

      const explainMethod = advancedService?.methods.find(
        (m) => m.name === 'explain',
      );
      expect(explainMethod?.resultMode).toBe('content');
    });

    it('should resolve simple named aliases, enums, and object types', () => {
      const result = parser.parseServiceFiles('tests/fixtures');
      const advancedService = result.find(
        (s) => s.className === 'AdvancedService',
      );
      const method = advancedService?.methods.find(
        (m) => m.name === 'searchWithTypes',
      );

      expect(method?.parameters[0].schema).toEqual({
        type: 'object',
        properties: {
          keyword: { type: 'string' },
          count: { type: 'number' },
          by: { type: 'string', enum: ['name', 'description'] },
          sort: { type: 'string', enum: ['name', 'votes'] },
          tags: {
            type: 'array',
            items: { type: 'string', enum: ['name', 'description'] },
          },
        },
        required: ['keyword', 'by', 'sort', 'tags'],
      });
      expect(method?.returnSchema).toEqual({
        type: 'object',
        properties: {
          packages: {
            type: 'array',
            items: { type: 'string' },
          },
          total: { type: 'number' },
          options: method?.parameters[0].schema,
        },
        required: ['packages', 'total', 'options'],
      });
    });
  });

  describe('parseServiceFilesWithMeta', () => {
    it('should extract serverInfo from class JSDoc tags', () => {
      const result = parser.parseServiceFilesWithMeta('examples');
      expect(result.serverInfo).toEqual({
        name: 'Example Calculator MCP',
        version: '0.1.0',
      });
    });
  });
});
