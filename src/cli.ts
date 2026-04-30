#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AstParser, type ResultMode } from './core/ast-parser.js';
import { Compiler } from './core/compiler.js';
import { Logger } from './core/logger.js';
import {
  DEFAULT_SERVER_INFO,
  mergeServerInfo,
  type ServerInfo,
} from './core/server-info.js';
import { ServiceContainer } from './core/service-container.js';
import { Transport } from './core/transport.js';

// Setup __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  // 1. Resolve CLI Arguments
  let servicesDir = '';
  let outputDir = '';
  let isCompileMode = false;
  const cliServerInfo: Partial<ServerInfo> = {};
  let resultMode: ResultMode = 'structured';
  let verbose = false;
  let silent = false;

  const rawArgs = process.argv.slice(2);

  const stripFlagWithValue = (
    argv: string[],
    flag: string,
  ): { argv: string[]; value?: string } => {
    const idx = argv.indexOf(flag);
    if (idx === -1) return { argv };
    const value = argv[idx + 1];
    const nextIsMissingOrFlag = !value || value.startsWith('-');
    if (nextIsMissingOrFlag) {
      console.error(`Error: ${flag} requires a value.`);
      process.exit(1);
    }
    const newArgv = argv.slice(0, idx).concat(argv.slice(idx + 2));
    return { argv: newArgv, value };
  };

  let args = rawArgs;
  if (args.includes('--verbose')) {
    verbose = true;
    args = args.filter((arg) => arg !== '--verbose');
  }
  if (args.includes('--silent')) {
    silent = true;
    args = args.filter((arg) => arg !== '--silent');
  }

  const logger = new Logger({ verbose, silent });

  const serverNameResult = stripFlagWithValue(args, '--server-name');
  args = serverNameResult.argv;
  const serverVersionResult = stripFlagWithValue(args, '--server-version');
  args = serverVersionResult.argv;
  const resultModeResult = stripFlagWithValue(args, '--result-mode');
  args = resultModeResult.argv;

  if (serverNameResult.value) cliServerInfo.name = serverNameResult.value;
  if (serverVersionResult.value)
    cliServerInfo.version = serverVersionResult.value;
  if (resultModeResult.value) {
    if (
      resultModeResult.value !== 'structured' &&
      resultModeResult.value !== 'content'
    ) {
      console.error(
        'Error: --result-mode must be either "structured" or "content".',
      );
      process.exit(1);
    }
    resultMode = resultModeResult.value;
  }

  const hasCompileFlag = args.includes('--compile');
  const hasRunFlag = args.includes('--run');

  if (hasCompileFlag && hasRunFlag) {
    console.error('Error: Use either --compile or --run, not both.');
    process.exit(1);
  }

  if (hasCompileFlag) {
    isCompileMode = true;
    const compileFlagIndex = args.indexOf('--compile');
    const sourceArg = args[compileFlagIndex + 1];
    const distArg = args[compileFlagIndex + 2];

    if (!sourceArg || sourceArg.startsWith('-')) {
      console.error('Error: Compile mode requires a <source> directory.');
      console.error('Usage: mcpt --compile <source> <dist?>');
      console.error(
        '       [--server-name <name>] [--server-version <version>] [--result-mode <structured|content>] [--verbose] [--silent]',
      );
      process.exit(1);
    }

    servicesDir = sourceArg;
    if (distArg && !distArg.startsWith('-')) {
      outputDir = distArg;
    }
  } else {
    const runFlagIndex = args.indexOf('--run');
    if (hasRunFlag) {
      const sourceArg = args[runFlagIndex + 1];
      if (!sourceArg || sourceArg.startsWith('-')) {
        console.error('Error: Run mode requires a <source> directory.');
        console.error('Usage: mcpt --run <source>');
        console.error(
          '       [--server-name <name>] [--server-version <version>] [--result-mode <structured|content>] [--verbose] [--silent]',
        );
        process.exit(1);
      }
      servicesDir = sourceArg;
    } else {
      const positionalArgs = args.filter((a) => !a.startsWith('-'));
      if (positionalArgs.length > 0) {
        servicesDir = positionalArgs[0];
      }
    }
  }

  if (!servicesDir) {
    console.error('Error: No <source> directory provided.');
    console.error('Usage: mcpt --run <source>');
    console.error('   or: mcpt --compile <source> <dist?>');
    console.error(
      '       [--server-name <name>] [--server-version <version>] [--result-mode <structured|content>] [--verbose] [--silent]',
    );
    process.exit(1);
  }

  const absoluteServicesDir = path.resolve(process.cwd(), servicesDir);

  if (!fs.existsSync(absoluteServicesDir)) {
    console.error(
      `Error: Services directory not found: ${absoluteServicesDir}`,
    );
    process.exit(1);
  }

  // Resolve tsconfig.json by walking up the directory tree
  let tsconfigPath = '';
  let currDir = absoluteServicesDir;
  while (true) {
    const potentialPath = path.join(currDir, 'tsconfig.json');
    if (fs.existsSync(potentialPath)) {
      tsconfigPath = potentialPath;
      break;
    }
    const parentDir = path.dirname(currDir);
    if (parentDir === currDir) break; // Reached root directory
    currDir = parentDir;
  }

  if (!tsconfigPath) {
    tsconfigPath = path.resolve(__dirname, '../tsconfig.json');
    if (!fs.existsSync(tsconfigPath)) {
      // If running from dist/index.js, tsconfig might be one level higher
      tsconfigPath = path.resolve(__dirname, '../../tsconfig.json');
    }
    logger.info(
      `No tsconfig.json found in ${absoluteServicesDir} or parents. Using fallback: ${tsconfigPath}`,
    );
  } else {
    logger.info(`Using tsconfig.json: ${tsconfigPath}`);
  }

  // 2. Handle Compile Mode
  if (isCompileMode) {
    if (!outputDir) {
      outputDir = path.join(absoluteServicesDir, 'dist');
    }
    const compiler = new Compiler(tsconfigPath, logger);
    await compiler.compile(absoluteServicesDir, outputDir, {
      serverInfo: cliServerInfo,
      resultMode,
    });
    logger.info('Compilation complete.');
    return;
  }

  logger.info(`Using services directory: ${absoluteServicesDir}`);

  // 3. Normal Startup Mode
  // 3.1 Check for package.json and node_modules
  const pkgPath = path.join(absoluteServicesDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const nodeModulesPath = path.join(absoluteServicesDir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      logger.warn(
        'package.json found in services directory, but node_modules is missing.',
      );
      logger.warn(
        'You may need to run "npm install" in that directory to resolve dependencies.',
      );
    }
  }

  const parser = new AstParser(tsconfigPath, logger);

  // 4. Scan and Parse Services
  logger.info(`Scanning for services in: ${absoluteServicesDir}...`);
  const { metadata, serverInfo: jsdocServerInfo } =
    parser.parseServiceFilesWithMeta(absoluteServicesDir);
  logger.info(`Found ${metadata.length} service classes.`);

  const effectiveServerInfo = mergeServerInfo(
    DEFAULT_SERVER_INFO,
    jsdocServerInfo,
    cliServerInfo,
  );

  // 5. Initialize Service Container
  const container = new ServiceContainer(metadata, logger);
  await container.initialize();

  // 6. Start MCP Transport Layer
  const transport = new Transport(container, {
    serverInfo: effectiveServerInfo,
    logger,
    resultMode,
  });
  await transport.listen();
}

main().catch((err) => {
  const logger = new Logger();
  logger.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
