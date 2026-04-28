import fs from 'node:fs';
import path from 'node:path';
import {
  type ClassDeclaration,
  type JSDocParameterTag,
  Project,
  SyntaxKind,
} from 'ts-morph';
import { Logger } from './logger.js';
import type { ServerInfo } from './server-info.js';

export interface MethodMetadata {
  name: string;
  toolName?: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
}

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
        const className = cls.getName() || 'Unknown';
        const methods = this.extractPublicMethods(cls);

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
      const description =
        jsDocs.length > 0 ? jsDocs[0].getDescription().trim() : '';
      let toolName: string | undefined;

      if (jsDocs.length > 0) {
        for (const tag of jsDocs[0].getTags()) {
          const tagName = tag.getTagName();
          const comment = tag.getCommentText()?.toString().trim() || '';
          if (!comment) continue;

          if (tagName === 'mcpToolName' || tagName === 'toolName') {
            toolName = comment;
            break;
          }
        }
      }

      const parameters = method.getParameters().map((p) => {
        const pName = p.getName();
        const pType = p.getType().getText();
        const pRequired = !p.isOptional();

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
          description: pDescription,
          required: pRequired,
        };
      });

      methods.push({
        name: methodName,
        toolName,
        description,
        parameters,
      });
    }

    return methods;
  }
}
