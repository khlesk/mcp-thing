import type { MethodMetadata } from '../src/core/ast-parser.js';
import { SchemaBuilder } from '../src/core/schema-builder.js';

describe('SchemaBuilder', () => {
  let builder: SchemaBuilder;

  beforeEach(() => {
    builder = new SchemaBuilder();
  });

  describe('buildInputSchema', () => {
    it('should create a valid JSON schema object', () => {
      const metadata: MethodMetadata = {
        name: 'add',
        description: 'Adds two numbers',
        parameters: [
          {
            name: 'a',
            description: 'First number',
            type: 'number',
            required: true,
          },
          {
            name: 'b',
            description: 'Second number',
            type: 'number',
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema).toHaveProperty('type', 'object');
      expect(schema).toHaveProperty('properties');
      expect(schema).toHaveProperty('required');
      expect(schema.required).toContain('a');
      expect(schema.required).toContain('b');
    });

    it('should map string type correctly', () => {
      const metadata: MethodMetadata = {
        name: 'greet',
        description: 'Greets user',
        parameters: [
          {
            name: 'name',
            description: 'User name',
            type: 'string',
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.name.type).toBe('string');
    });

    it('should map number type correctly', () => {
      const metadata: MethodMetadata = {
        name: 'calc',
        description: 'Calc',
        parameters: [
          {
            name: 'age',
            description: 'User age',
            type: 'number',
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.age.type).toBe('number');
    });

    it('should map boolean type correctly', () => {
      const metadata: MethodMetadata = {
        name: 'test',
        description: 'Test',
        parameters: [
          {
            name: 'active',
            description: 'Is active',
            type: 'boolean',
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.active.type).toBe('boolean');
    });

    it('should handle optional parameters', () => {
      const metadata: MethodMetadata = {
        name: 'greet',
        description: 'Greets user',
        parameters: [
          {
            name: 'name',
            description: 'User name',
            type: 'string',
            required: true,
          },
          {
            name: 'greeting',
            description: 'Optional greeting',
            type: 'string',
            required: false,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.required).toContain('name');
      expect(schema.required).not.toContain('greeting');
    });

    it('should map array types correctly', () => {
      const metadata: MethodMetadata = {
        name: 'extractArticles',
        description: 'Extracts articles',
        parameters: [
          {
            name: 'urls',
            description: 'URLs to extract',
            type: 'string[]',
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.urls.type).toBe('array');
      expect(schema.properties.urls.items).toEqual({ type: 'string' });
    });

    it('should map generic array types correctly', () => {
      const metadata: MethodMetadata = {
        name: 'sum',
        description: 'Sums values',
        parameters: [
          {
            name: 'values',
            description: 'Values to sum',
            type: 'Array<number>',
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.values.type).toBe('array');
      expect(schema.properties.values.items).toEqual({ type: 'number' });
    });

    it('should handle empty parameters', () => {
      const metadata: MethodMetadata = {
        name: 'test',
        description: 'Test',
        parameters: [],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.type).toBe('object');
      expect(schema.properties).toEqual({});
      expect(schema.required).toBeUndefined();
    });

    it('should preserve optional number unions and constraints', () => {
      const metadata: MethodMetadata = {
        name: 'search',
        description: 'Search',
        parameters: [
          {
            name: 'count',
            description: 'Maximum result count',
            type: 'number | undefined',
            required: false,
            constraints: {
              minimum: 1,
              maximum: 500,
              default: 50,
            },
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.count).toEqual({
        type: 'number',
        description: 'Maximum result count',
        minimum: 1,
        maximum: 500,
        default: 50,
      });
      expect(schema.required).toBeUndefined();
    });

    it('should infer string literal unions as enums', () => {
      const metadata: MethodMetadata = {
        name: 'search',
        description: 'Search',
        parameters: [
          {
            name: 'by',
            description: 'Search field',
            type: '"name" | "description"',
            required: false,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.by).toEqual({
        type: 'string',
        enum: ['name', 'description'],
        description: 'Search field',
      });
    });

    it('should infer array item enums', () => {
      const metadata: MethodMetadata = {
        name: 'filter',
        description: 'Filter',
        parameters: [
          {
            name: 'fields',
            description: 'Fields',
            type: 'Array<"name" | "votes">',
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.fields).toEqual({
        type: 'array',
        items: {
          type: 'string',
          enum: ['name', 'votes'],
        },
        description: 'Fields',
      });
    });

    it('should prefer resolved parameter schemas over type text fallback', () => {
      const metadata: MethodMetadata = {
        name: 'search',
        description: 'Search',
        parameters: [
          {
            name: 'options',
            description: 'Search options',
            type: 'SearchOptions',
            schema: {
              type: 'object',
              properties: {
                by: { type: 'string', enum: ['name', 'description'] },
                count: { type: 'number' },
              },
              required: ['by'],
            },
            required: true,
          },
        ],
      };

      const schema = builder.buildInputSchema(metadata);

      expect(schema.properties.options).toEqual({
        type: 'object',
        properties: {
          by: { type: 'string', enum: ['name', 'description'] },
          count: { type: 'number' },
        },
        required: ['by'],
        description: 'Search options',
      });
    });
  });

  describe('buildOutputSchema', () => {
    it('should infer simple object return schemas', () => {
      const metadata: MethodMetadata = {
        name: 'search',
        description: 'Search',
        returnType: '{ packages: string[]; total: number; }',
        parameters: [],
      };

      const schema = builder.buildOutputSchema(metadata);

      expect(schema).toEqual({
        type: 'object',
        properties: {
          packages: {
            type: 'array',
            items: { type: 'string' },
          },
          total: { type: 'number' },
        },
        required: ['packages', 'total'],
      });
    });

    it('should wrap primitive return schemas in result', () => {
      const metadata: MethodMetadata = {
        name: 'explain',
        description: 'Explain',
        returnType: 'string',
        parameters: [],
      };

      expect(builder.buildOutputSchema(metadata)).toEqual({
        type: 'object',
        properties: {
          result: { type: 'string' },
        },
        required: ['result'],
      });
    });

    it('should prefer resolved return schemas over type text fallback', () => {
      const metadata: MethodMetadata = {
        name: 'search',
        description: 'Search',
        returnType: 'SearchResult',
        returnSchema: {
          type: 'object',
          properties: {
            total: { type: 'number' },
          },
          required: ['total'],
        },
        parameters: [],
      };

      expect(builder.buildOutputSchema(metadata)).toEqual({
        type: 'object',
        properties: {
          total: { type: 'number' },
        },
        required: ['total'],
      });
    });
  });
});
