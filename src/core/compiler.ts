import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AstParser } from './ast-parser.js';
import { Logger } from './logger.js';
import {
  DEFAULT_SERVER_INFO,
  mergeServerInfo,
  type ServerInfo,
} from './server-info.js';

export interface CompileOptions {
  serverInfo?: Partial<ServerInfo>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Compiler {
  private parser: AstParser;
  private logger: Logger;

  constructor(tsconfigPath: string, logger: Logger = new Logger()) {
    this.logger = logger;
    this.parser = new AstParser(tsconfigPath, logger);
  }

  /**
   * Compiles TS services into JS and generates a static manifest and entrypoint.
   * @param servicesDir The directory containing source .ts services
   * @param outputDir The destination directory for the build
   */
  public async compile(
    servicesDir: string,
    outputDir: string,
    options: CompileOptions = {},
  ): Promise<void> {
    const absoluteOutputDir = path.resolve(outputDir);

    if (!fs.existsSync(absoluteOutputDir)) {
      fs.mkdirSync(absoluteOutputDir, { recursive: true });
    }

    this.logger.info('Starting compilation...');
    this.logger.info(`Source: ${servicesDir}`);
    this.logger.info(`Output: ${absoluteOutputDir}`);

    // 1. Parse Metadata
    const { metadata, serverInfo: parsedServerInfo } =
      this.parser.parseServiceFilesWithMeta(servicesDir);
    const resolvedServerInfo = mergeServerInfo(
      DEFAULT_SERVER_INFO,
      parsedServerInfo,
      options.serverInfo,
    );

    // 2. Generate Manifest
    // Change file paths in metadata to be relative to the output directory
    // In the compiled version, we assume services are in the same directory as the manifest
    const manifestMetadata = metadata.map((service) => {
      const fileName = path.basename(service.fileName).replace(/\.ts$/, '.js');
      return {
        ...service,
        fileName: `./${fileName}`, // Relative path for dynamic import
      };
    });

    const manifestPath = path.join(absoluteOutputDir, 'schema-manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          serverInfo: resolvedServerInfo,
          services: manifestMetadata,
        },
        null,
        2,
      ),
    );
    this.logger.info(`Generated manifest: ${manifestPath}`);

    // 3. Emit JS Files
    this.logger.info('Emitting JS files...');
    const normalizedServicesDir = path
      .normalize(path.resolve(servicesDir))
      .toLowerCase();

    const sourceFiles = this.parser.project.getSourceFiles().filter((sf) => {
      const sfPath = path.normalize(sf.getFilePath()).toLowerCase();
      return sfPath.startsWith(normalizedServicesDir);
    });

    this.logger.info(`Found ${sourceFiles.length} files to emit.`);

    for (const sourceFile of sourceFiles) {
      const fileName = path
        .basename(sourceFile.getFilePath())
        .replace(/\.ts$/, '.js');
      const targetPath = path.join(absoluteOutputDir, fileName);

      this.logger.info(`Emitting ${sourceFile.getFilePath()} -> ${targetPath}`);

      const emitOutput = sourceFile.getEmitOutput();
      const outputFile = emitOutput
        .getOutputFiles()
        .find((f) => f.getFilePath().endsWith('.js'));

      if (outputFile) {
        fs.writeFileSync(targetPath, outputFile.getText());
        this.logger.info(`Successfully emitted: ${targetPath}`);
      } else {
        this.logger.warn(
          `Could not get direct emit output for ${sourceFile.getFilePath()}, trying memory emit...`,
        );
        // Fallback: try to just transpile the file content if emit fails
        const result = this.parser.project.emitToMemory({
          targetSourceFile: sourceFile,
        });
        const memFile = result
          .getFiles()
          .find((f) => f.filePath.endsWith('.js'));
        if (memFile) {
          fs.writeFileSync(targetPath, memFile.text);
          this.logger.info(
            `Successfully emitted (memory fallback): ${targetPath}`,
          );
        } else {
          this.logger.error(`Failed to emit ${sourceFile.getFilePath()}`);
        }
      }
    }

    // 4. Generate package.json for the build
    this.generatePackageJson(absoluteOutputDir);

    // 5. Generate Entrypoint (index.js)
    this.generateEntrypoint(absoluteOutputDir);
  }

  private generatePackageJson(outputDir: string): void {
    const packageVersion = this.getCurrentPackageVersion();
    const pkg = {
      name: 'mcp-service-build',
      version: '1.0.0',
      type: 'module',
      main: 'index.js',
      dependencies: {
        'mcp-thing': `^${packageVersion}`,
      },
    };
    fs.writeFileSync(
      path.join(outputDir, 'package.json'),
      JSON.stringify(pkg, null, 2),
    );
  }

  private getCurrentPackageVersion(): string {
    const packageJsonPath = path.resolve(__dirname, '../../package.json');

    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(
        `Unable to find mcp-thing package.json at ${packageJsonPath}`,
      );
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const version = packageJson.version;

    if (typeof version !== 'string' || version.length === 0) {
      throw new Error(
        `Invalid mcp-thing version in package.json at ${packageJsonPath}`,
      );
    }

    return version;
  }

  private generateEntrypoint(outputDir: string): void {
    const entrypointContent = `import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ServiceContainer, Transport, Logger } from 'mcp-thing';

// Setup __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const logger = new Logger();

    // 1. Load Static Manifest
    const manifestPath = path.join(__dirname, 'schema-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        logger.error('Fatal: schema-manifest.json not found in build directory.');
        process.exit(1);
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const metadata = Array.isArray(manifest) ? manifest : manifest.services;
    const serverInfo = Array.isArray(manifest) ? undefined : manifest.serverInfo;
    
    // 2. Initialize Service Container in static mode
    // We adjust the file paths in metadata to be absolute relative to __dirname
    const absoluteMetadata = metadata.map(m => ({
        ...m,
        fileName: path.resolve(__dirname, m.fileName)
    }));
    
    const container = new ServiceContainer(absoluteMetadata, logger);
    await container.initialize();
    
    // 3. Start Transport
    const transport = new Transport(container, { serverInfo, logger });
    await transport.listen();
}

main().catch(err => {
    const logger = new Logger();
    logger.error('Fatal error in compiled MCP server:', err);
    process.exit(1);
});
`;

    const entrypointPath = path.join(outputDir, 'index.js');
    fs.writeFileSync(entrypointPath, entrypointContent);
    this.logger.info(`Generated entrypoint: ${entrypointPath}`);
  }
}
