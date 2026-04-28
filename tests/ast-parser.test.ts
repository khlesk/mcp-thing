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
