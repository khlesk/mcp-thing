import type { JsonSchema, MethodMetadata } from './ast-parser.js';
import { Logger } from './logger.js';

export class SchemaBuilder {
  private logger: Logger;

  constructor(logger: Logger = new Logger()) {
    this.logger = logger;
  }

  public buildInputSchema(metadata: MethodMetadata): JsonSchema {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const p of metadata.parameters) {
      properties[p.name] = {
        ...(p.schema || this.mapTsTypeToJsonSchema(p.type)),
        description: p.description,
        ...p.constraints,
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

  public buildOutputSchema(metadata: MethodMetadata): JsonSchema | undefined {
    if (!metadata.returnType) return undefined;

    const normalizedType = this.unwrapType(metadata.returnType.trim());
    if (normalizedType === 'void' || normalizedType === 'undefined') {
      return undefined;
    }

    const schema =
      metadata.returnSchema ||
      this.mapTsTypeToJsonSchema(normalizedType, {
        allowObjectRoot: true,
        warnOnFallback: false,
      });
    if (schema.type === 'object') return schema;

    if (this.isInferableNonObjectType(normalizedType)) {
      return {
        type: 'object',
        properties: {
          result: schema,
        },
        required: ['result'],
      };
    }

    this.logger.warn(
      `Unsupported return type "${normalizedType}" cannot be exposed as an output schema.`,
    );
    return undefined;
  }

  private mapTsTypeToJsonSchema(
    tsType: string,
    options: { allowObjectRoot?: boolean; warnOnFallback?: boolean } = {},
  ): JsonSchema {
    const normalizedType = this.unwrapType(tsType.trim());

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

    const unionParts = this.splitTopLevelUnion(normalizedType);
    if (unionParts.length > 1) {
      const nonNullishParts = unionParts.filter(
        (part) => part !== 'undefined' && part !== 'null',
      );
      const hasNull = unionParts.includes('null');

      if (nonNullishParts.length === 1) {
        const schema = this.mapTsTypeToJsonSchema(nonNullishParts[0]);
        if (hasNull && typeof schema.type === 'string') {
          return { ...schema, type: [schema.type, 'null'] };
        }
        return schema;
      }

      const literalEnum = this.literalUnionToEnum(nonNullishParts);
      if (literalEnum) {
        return hasNull
          ? { ...literalEnum, enum: [...literalEnum.enum, null] }
          : literalEnum;
      }

      return {
        anyOf: nonNullishParts.map((part) => this.mapTsTypeToJsonSchema(part)),
      };
    }

    const literal = this.parseLiteral(normalizedType);
    if (literal !== undefined) {
      return {
        type: typeof literal,
        enum: [literal],
      };
    }

    if (options.allowObjectRoot && this.isObjectTypeText(normalizedType)) {
      return this.mapObjectTypeToJsonSchema(normalizedType);
    }

    switch (normalizedType.toLowerCase()) {
      case 'string':
        return { type: 'string' };
      case 'number':
        return { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'void':
      case 'undefined':
        return { type: 'null' };
      default:
        if (options.warnOnFallback !== false) {
          this.logger.warn(
            `Unsupported TypeScript type "${normalizedType}" degraded to string schema.`,
          );
        }
        return { type: 'string' };
    }
  }

  private unwrapType(tsType: string): string {
    const promiseMatch = tsType.match(/^Promise<(.+)>$/);
    if (promiseMatch) return promiseMatch[1].trim();

    return tsType;
  }

  private splitTopLevelUnion(tsType: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | undefined;
    let current = '';

    for (let i = 0; i < tsType.length; i += 1) {
      const char = tsType[i];
      if ((char === '"' || char === "'") && tsType[i - 1] !== '\\') {
        quote = quote === char ? undefined : quote || char;
      }

      if (!quote) {
        if (char === '<' || char === '(' || char === '{' || char === '[') {
          depth += 1;
        }
        if (char === '>' || char === ')' || char === '}' || char === ']') {
          depth -= 1;
        }
        if (char === '|' && depth === 0) {
          parts.push(current.trim());
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  private literalUnionToEnum(parts: string[]):
    | {
        type: string;
        enum: Array<string | number | boolean>;
      }
    | undefined {
    const literals = parts.map((part) => this.parseLiteral(part));
    if (literals.some((literal) => literal === undefined)) return undefined;

    const literalTypes = new Set(literals.map((literal) => typeof literal));
    if (literalTypes.size !== 1) return undefined;

    const type = literalTypes.values().next().value as string;

    return {
      type,
      enum: literals as Array<string | number | boolean>,
    };
  }

  private parseLiteral(
    typeText: string,
  ): string | number | boolean | undefined {
    if (
      (typeText.startsWith("'") && typeText.endsWith("'")) ||
      (typeText.startsWith('"') && typeText.endsWith('"'))
    ) {
      return typeText.slice(1, -1);
    }

    if (typeText === 'true') return true;
    if (typeText === 'false') return false;

    if (/^-?\d+(\.\d+)?$/.test(typeText)) return Number(typeText);

    return undefined;
  }

  private isObjectTypeText(typeText: string): boolean {
    return typeText.startsWith('{') && typeText.endsWith('}');
  }

  private isInferableNonObjectType(typeText: string): boolean {
    const normalizedType = this.unwrapType(typeText.trim());
    if (this.isObjectTypeText(normalizedType)) return false;
    if (
      ['string', 'number', 'boolean', 'null'].includes(
        normalizedType.toLowerCase(),
      )
    ) {
      return true;
    }
    if (this.parseLiteral(normalizedType) !== undefined) return true;
    if (normalizedType.endsWith('[]')) return true;
    if (normalizedType.match(/^Array<(.+)>$/)) return true;

    const unionParts = this.splitTopLevelUnion(normalizedType);
    if (unionParts.length > 1) {
      return unionParts
        .filter((part) => part !== 'undefined' && part !== 'null')
        .every((part) => this.isInferableNonObjectType(part));
    }

    return false;
  }

  private mapObjectTypeToJsonSchema(typeText: string): JsonSchema {
    const body = typeText.slice(1, -1).trim();
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];

    for (const rawProperty of body.split(';')) {
      const property = rawProperty.trim();
      if (!property) continue;

      const match = property.match(
        /^(?:readonly\s+)?["']?([\w$-]+)["']?(\?)?:\s*(.+)$/,
      );
      if (!match) continue;

      const [, name, optionalMarker, propertyType] = match;
      properties[name] = this.mapTsTypeToJsonSchema(propertyType.trim(), {
        allowObjectRoot: true,
        warnOnFallback: false,
      });

      if (!optionalMarker && !propertyType.includes('undefined')) {
        required.push(name);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
}
