import type { MethodMetadata } from './ast-parser.js';

export class SchemaBuilder {
  public buildInputSchema(metadata: MethodMetadata): object {
    const properties: Record<string, object> = {};
    const required: string[] = [];

    for (const p of metadata.parameters) {
      properties[p.name] = {
        ...this.mapTsTypeToJsonSchema(p.type),
        description: p.description,
      };

      if (p.required) {
        required.push(p.name);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  private mapTsTypeToJsonSchema(tsType: string): object {
    const normalizedType = tsType.trim();

    if (normalizedType.endsWith('[]')) {
      return {
        type: 'array',
        items: this.mapTsTypeToJsonSchema(normalizedType.slice(0, -2)),
      };
    }

    const arrayMatch = normalizedType.match(/^Array<(.+)>$/);
    if (arrayMatch) {
      return {
        type: 'array',
        items: this.mapTsTypeToJsonSchema(arrayMatch[1].trim()),
      };
    }

    switch (normalizedType.toLowerCase()) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      default:
        return { type: 'string' };
    }
  }
}
