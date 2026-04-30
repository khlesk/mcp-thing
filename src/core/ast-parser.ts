import fs from 'node:fs';
import path from 'node:path';
import {
  type ClassDeclaration,
  type JSDoc,
  type JSDocParameterTag,
  type MethodDeclaration,
  Node,
  type ParameterDeclaration,
  Project,
  SyntaxKind,
  type Type,
} from 'ts-morph';
import { Logger } from './logger.js';
import type { ServerInfo } from './server-info.js';

export interface MethodMetadata {
  name: string;
  toolName?: string;
  description: string;
  returnType?: string;
  returnSchema?: JsonSchema;
  resultMode?: ResultMode;
  parameters: Array<{
    name: string;
    type: string;
    schema?: JsonSchema;
    description: string;
    required: boolean;
    constraints?: JsonSchemaConstraints;
  }>;
}

export type ResultMode = 'structured' | 'content';

export type JsonSchemaConstraints = Record<string, string | number | boolean>;

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};

export interface ServiceMetadata {
  className: string;
  fileName: string;
  methods: MethodMetadata[];
}

export interface ParseResult {
  metadata: ServiceMetadata[];
  serverInfo?: Partial<ServerInfo>;
}

export class AstParser {
  public project: Project;
  private logger: Logger;

  constructor(tsconfigPath: string, logger: Logger = new Logger()) {
    this.logger = logger;
    this.project = new Project({
      tsConfigFilePath: tsconfigPath,
    });
  }

  public parseServiceFiles(servicesDir: string): ServiceMetadata[] {
    return this.parseServiceFilesWithMeta(servicesDir).metadata;
  }

  public parseServiceFilesWithMeta(servicesDir: string): ParseResult {
    const fullServicesDir = path.resolve(servicesDir);

    // Reset the project between parses so we only emit files from the active servicesDir.
    for (const sourceFile of this.project.getSourceFiles()) {
      this.project.removeSourceFile(sourceFile);
    }

    const allFiles: string[] = [];
    const findFiles = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === 'dist'
          )
            continue;
          findFiles(fullPath);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.d.ts')
        ) {
          allFiles.push(fullPath);
        }
      }
    };

    this.logger.info(`Finding files in ${fullServicesDir}...`);
    findFiles(fullServicesDir);
    allFiles.sort((a, b) => a.localeCompare(b));
    this.logger.info(`Found ${allFiles.length} candidate files.`);

    const sourceFiles = allFiles.map((filePath) => {
      this.logger.info(`Adding to AST project: ${filePath}`);
      return this.project.addSourceFileAtPath(filePath);
    });

    const services: ServiceMetadata[] = [];
    const discoveredServerInfo: Partial<ServerInfo> = {};
    const conflicts: string[] = [];

    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.getFilePath();
      this.logger.info(`Parsing service file: ${filePath}`);
      const classes = sourceFile.getClasses().filter((c) => c.isExported());

      for (const cls of classes) {
        if (this.hasTag(cls.getJsDocs(), 'mcpIgnore')) continue;

        const className = cls.getName() || 'Unknown';
        const methods = this.extractPublicMethods(cls);
        if (methods.length === 0) continue;

        const classServerInfo = this.extractServerInfoFromClassJsDoc(cls);
        if (classServerInfo.name) {
          if (
            discoveredServerInfo.name &&
            discoveredServerInfo.name !== classServerInfo.name
          ) {
            conflicts.push(
              `name: "${discoveredServerInfo.name}" vs "${classServerInfo.name}" in ${filePath}#${className}`,
            );
          } else {
            discoveredServerInfo.name = classServerInfo.name;
          }
        }
        if (classServerInfo.version) {
          if (
            discoveredServerInfo.version &&
            discoveredServerInfo.version !== classServerInfo.version
          ) {
            conflicts.push(
              `version: "${discoveredServerInfo.version}" vs "${classServerInfo.version}" in ${filePath}#${className}`,
            );
          } else {
            discoveredServerInfo.version = classServerInfo.version;
          }
        }

        services.push({
          className,
          fileName: sourceFile.getFilePath(),
          methods,
        });
      }
    }

    if (conflicts.length > 0) {
      this.logger.warn(
        'Multiple conflicting serverInfo annotations found. Keeping the first encountered values.',
      );
      for (const conflict of conflicts) this.logger.warn(conflict);
    }

    const hasServerInfo =
      discoveredServerInfo.name || discoveredServerInfo.version;

    return {
      metadata: services,
      serverInfo: hasServerInfo ? discoveredServerInfo : undefined,
    };
  }

  private extractServerInfoFromClassJsDoc(
    cls: ClassDeclaration,
  ): Partial<ServerInfo> {
    const jsDocs = cls.getJsDocs();
    if (jsDocs.length === 0) return {};

    const tags = jsDocs[0].getTags();
    let name: string | undefined;
    let version: string | undefined;

    for (const tag of tags) {
      const tagName = tag.getTagName();
      const comment = tag.getCommentText()?.toString().trim() || '';
      if (!comment) continue;

      if (tagName === 'mcpServerName' || tagName === 'serverName')
        name = comment;
      if (tagName === 'mcpServerVersion' || tagName === 'serverVersion')
        version = comment;
    }

    return { name, version };
  }

  private extractPublicMethods(cls: ClassDeclaration): MethodMetadata[] {
    const methods: MethodMetadata[] = [];
    const publicMethods = cls
      .getMethods()
      .filter((m) => m.getScope() === 'public' || !m.getScope());

    for (const method of publicMethods) {
      const methodName = method.getName();
      // Skip constructor
      if (methodName === 'constructor') continue;

      const jsDocs = method.getJsDocs();
      if (this.hasTag(jsDocs, 'mcpIgnore')) continue;

      const description =
        jsDocs.length > 0 ? jsDocs[0].getDescription().trim() : '';
      let toolName: string | undefined;
      let resultMode: ResultMode | undefined;

      if (jsDocs.length > 0) {
        for (const tag of jsDocs[0].getTags()) {
          const tagName = tag.getTagName();
          const comment = tag.getCommentText()?.toString().trim() || '';

          if (tagName === 'mcpToolName' || tagName === 'toolName') {
            toolName = comment;
          }

          if (tagName === 'mcpResultMode') {
            resultMode = this.parseResultMode(comment, methodName);
          }
        }
      }

      const parameters = method.getParameters().map((p) => {
        const pName = p.getName();
        const pType = p.getType().getText();
        const pRequired = this.isRequiredParameter(p);

        // Extract description from @param JSDoc tag if available
        let pDescription = '';
        if (jsDocs.length > 0) {
          const paramTag = jsDocs[0]
            .getTags()
            .find(
              (t) =>
                t.getKind() === SyntaxKind.JSDocParameterTag &&
                (t as JSDocParameterTag).getName() === pName,
            );
          if (paramTag) {
            pDescription = paramTag.getCommentText()?.toString().trim() || '';
          }
        }

        return {
          name: pName,
          type: pType,
          schema: this.typeToSchema(p.getType()),
          description: pDescription,
          required: pRequired,
          constraints: this.extractConstraintsForParameter(jsDocs, pName),
        };
      });

      methods.push({
        name: methodName,
        toolName,
        description,
        returnType: this.getReturnTypeText(method),
        returnSchema: this.typeToSchema(method.getReturnType(), {
          unwrapPromise: true,
        }),
        resultMode,
        parameters,
      });
    }

    return methods;
  }

  private hasTag(jsDocs: JSDoc[], tagName: string): boolean {
    return jsDocs.some((doc) =>
      doc.getTags().some((tag) => tag.getTagName() === tagName),
    );
  }

  private parseResultMode(
    comment: string,
    methodName: string,
  ): ResultMode | undefined {
    const normalized = comment.trim().toLowerCase();
    if (normalized === 'structured' || normalized === 'content') {
      return normalized;
    }

    this.logger.warn(
      `Ignoring invalid @mcpResultMode on ${methodName}: "${comment}". Expected "structured" or "content".`,
    );
    return undefined;
  }

  private isRequiredParameter(parameter: ParameterDeclaration): boolean {
    if (parameter.isOptional() || parameter.hasInitializer()) return false;

    const typeText = parameter.getType().getText();
    return !/(^|\|)\s*(undefined|null)\s*(\||$)/.test(typeText);
  }

  private getReturnTypeText(method: MethodDeclaration): string {
    return method.getReturnType().getText(method);
  }

  private typeToSchema(
    type: Type,
    options: { unwrapPromise?: boolean; seen?: Set<string> } = {},
  ): JsonSchema | undefined {
    const seen = options.seen || new Set<string>();
    const normalizedType = options.unwrapPromise
      ? this.unwrapPromiseType(type)
      : type;
    const typeId = normalizedType.getText();
    if (seen.has(typeId)) {
      this.logger.warn(
        `Recursive or repeated type "${typeId}" cannot be fully exposed as schema.`,
      );
      return undefined;
    }
    seen.add(typeId);

    if (normalizedType.isString()) return { type: 'string' };
    if (normalizedType.isNumber()) return { type: 'number' };
    if (normalizedType.isBoolean()) return { type: 'boolean' };
    if (normalizedType.isStringLiteral()) {
      const value = normalizedType.getLiteralValue();
      return typeof value === 'string'
        ? { type: 'string', enum: [value] }
        : undefined;
    }
    if (normalizedType.isNumberLiteral()) {
      const value = normalizedType.getLiteralValue();
      return typeof value === 'number'
        ? { type: 'number', enum: [value] }
        : undefined;
    }
    if (normalizedType.isBooleanLiteral()) {
      return {
        type: 'boolean',
        enum: [normalizedType.getText() === 'true'],
      };
    }
    if (normalizedType.isNull()) return { type: 'null' };
    if (normalizedType.isUndefined() || normalizedType.isVoid()) {
      return { type: 'null' };
    }

    const arrayElementType = normalizedType.getArrayElementType();
    if (arrayElementType) {
      return {
        type: 'array',
        items: this.typeToSchema(arrayElementType, { seen: new Set(seen) }),
      };
    }

    if (normalizedType.isUnion()) {
      return this.unionTypeToSchema(normalizedType, new Set(seen));
    }

    const enumSchema = this.enumTypeToSchema(normalizedType);
    if (enumSchema) return enumSchema;

    const properties = normalizedType.getProperties();
    if (properties.length > 0 && this.isPlainObjectLikeType(normalizedType)) {
      const propertiesSchema: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const property of properties) {
        const declaration = property.getValueDeclaration();
        if (!declaration) continue;

        const propertySchema = this.typeToSchema(declaration.getType(), {
          seen: new Set(seen),
        });
        if (!propertySchema) continue;

        propertiesSchema[property.getName()] = propertySchema;
        if (!property.isOptional()) required.push(property.getName());
      }

      if (Object.keys(propertiesSchema).length === 0) return undefined;
      const objectSchema: JsonSchema = {
        type: 'object',
        properties: propertiesSchema,
      };
      if (required.length > 0) objectSchema.required = required;
      return objectSchema;
    }

    return undefined;
  }

  private unwrapPromiseType(type: Type): Type {
    const symbolName = type.getSymbol()?.getName();
    if (symbolName === 'Promise') {
      const typeArguments = type.getTypeArguments();
      if (typeArguments.length === 1) return typeArguments[0];
    }

    return type;
  }

  private unionTypeToSchema(type: Type, seen: Set<string>): JsonSchema {
    const unionTypes = type.getUnionTypes();
    const nonNullishTypes = unionTypes.filter(
      (part) => !part.isUndefined() && !part.isNull(),
    );
    const hasNull = unionTypes.some((part) => part.isNull());

    if (nonNullishTypes.length === 1) {
      const schema = this.typeToSchema(nonNullishTypes[0], {
        seen: new Set(seen),
      });
      if (!schema) return { type: 'string' };
      if (hasNull && typeof schema.type === 'string') {
        return { ...schema, type: [schema.type, 'null'] };
      }
      return schema;
    }

    const literalSchemas = nonNullishTypes
      .map((part) => this.typeToSchema(part, { seen: new Set(seen) }))
      .filter((schema): schema is JsonSchema => Boolean(schema));
    const enumValues = literalSchemas.flatMap((schema) => schema.enum || []);
    const enumTypes = new Set(literalSchemas.map((schema) => schema.type));
    if (
      literalSchemas.length === nonNullishTypes.length &&
      enumValues.length === literalSchemas.length &&
      enumTypes.size === 1
    ) {
      return {
        type: enumTypes.values().next().value as string,
        enum: hasNull ? [...enumValues, null] : enumValues,
      };
    }

    return {
      anyOf: literalSchemas.length > 0 ? literalSchemas : [{ type: 'string' }],
    };
  }

  private enumTypeToSchema(type: Type): JsonSchema | undefined {
    const symbol = type.getSymbol() || type.getAliasSymbol();
    const declarations = symbol?.getDeclarations() || [];
    const enumDeclaration = declarations.find(Node.isEnumDeclaration);
    if (!enumDeclaration) {
      return undefined;
    }

    const values = enumDeclaration
      .getMembers()
      .map((member) => {
        const value = member.getValue();
        return value === undefined ? member.getName() : value;
      })
      .filter((value): value is string | number =>
        ['string', 'number'].includes(typeof value),
      );
    if (values.length === 0) return undefined;

    const valueTypes = new Set(values.map((value) => typeof value));
    if (valueTypes.size !== 1) return undefined;

    return {
      type: valueTypes.values().next().value as string,
      enum: values as Array<string | number | boolean>,
    };
  }

  private isPlainObjectLikeType(type: Type): boolean {
    if (type.isClass() || type.isClassOrInterface()) return type.isInterface();

    const symbolName = type.getSymbol()?.getName();
    if (symbolName && ['Array', 'Promise'].includes(symbolName)) return false;

    const callSignatures = type.getCallSignatures();
    const constructSignatures = type.getConstructSignatures();
    return callSignatures.length === 0 && constructSignatures.length === 0;
  }

  private extractConstraintsForParameter(
    jsDocs: JSDoc[],
    parameterName: string,
  ): JsonSchemaConstraints | undefined {
    const constraints: JsonSchemaConstraints = {};
    const tagToKeyword: Record<string, string> = {
      minLength: 'minLength',
      maxLength: 'maxLength',
      minimum: 'minimum',
      maximum: 'maximum',
      exclusiveMinimum: 'exclusiveMinimum',
      exclusiveMaximum: 'exclusiveMaximum',
      default: 'default',
      minItems: 'minItems',
      maxItems: 'maxItems',
      pattern: 'pattern',
      format: 'format',
    };

    for (const jsDoc of jsDocs) {
      for (const tag of jsDoc.getTags()) {
        const keyword = tagToKeyword[tag.getTagName()];
        if (!keyword) continue;

        const comment = tag.getCommentText()?.toString().trim() || '';
        const [targetName, ...valueParts] = comment.split(/\s+/);
        if (targetName !== parameterName || valueParts.length === 0) continue;

        constraints[keyword] = this.parseConstraintValue(
          keyword,
          valueParts.join(' '),
        );
      }
    }

    return Object.keys(constraints).length > 0 ? constraints : undefined;
  }

  private parseConstraintValue(
    keyword: string,
    rawValue: string,
  ): string | number | boolean {
    if (
      [
        'minLength',
        'maxLength',
        'minimum',
        'maximum',
        'exclusiveMinimum',
        'exclusiveMaximum',
        'minItems',
        'maxItems',
      ].includes(keyword)
    ) {
      const parsed = Number(rawValue);
      return Number.isNaN(parsed) ? rawValue : parsed;
    }

    if (keyword === 'default') {
      if (rawValue === 'true') return true;
      if (rawValue === 'false') return false;
      const parsed = Number(rawValue);
      return Number.isNaN(parsed) ? rawValue : parsed;
    }

    return rawValue;
  }
}
