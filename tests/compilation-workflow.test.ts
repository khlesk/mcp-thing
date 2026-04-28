import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const rootDir = process.cwd();
const testServicesDir = path.join(rootDir, 'tests', 'test-services');
const rootPackageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'),
);

const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

describe('Compilation Workflow Test', () => {
  beforeAll(() => {
    // Ensure the main project is built first
    console.log('Ensuring mcp-thing is built...');
    execSync(`${npmCmd} run build`, { cwd: rootDir, stdio: 'inherit' });

    // Link the current project to test-services
    console.log('Installing dependencies in test-services...');
    execSync(`${npmCmd} install`, { cwd: testServicesDir, stdio: 'inherit' });
  });

  it('should successfully compile test-services using the library CLI', () => {
    const distDir = path.join(testServicesDir, 'dist');

    // Clean previous build if any
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true });
    }

    console.log('Running compile in test-services...');
    const cliPath = path.join(
      testServicesDir,
      'node_modules',
      'mcp-thing',
      'dist',
      'cli.js',
    );
    execSync(
      `"${process.execPath}" "${cliPath}" --compile . --server-name "Compiled Server" --server-version "2.0.0"`,
      { cwd: testServicesDir, stdio: 'inherit' },
    );

    // Verify outputs
    expect(fs.existsSync(path.join(distDir, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'schema-manifest.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(distDir, 'HelloService.js'))).toBe(true);
    expect(fs.existsSync(path.join(distDir, 'package.json'))).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(distDir, 'schema-manifest.json'), 'utf-8'),
    );
    const buildPackageJson = JSON.parse(
      fs.readFileSync(path.join(distDir, 'package.json'), 'utf-8'),
    );
    expect(manifest.serverInfo).toEqual({
      name: 'Compiled Server',
      version: '2.0.0',
    });
    expect(manifest.services[0].methods[0].toolName).toBe('hello');
    expect(buildPackageJson.dependencies['mcp-thing']).toBe(
      `^${rootPackageJson.version}`,
    );
  });

  it('should be able to start the compiled server (smoke test)', async () => {
    const distDir = path.join(testServicesDir, 'dist');

    const { spawnSync } = await import('node:child_process');

    console.log('Installing runtime dependency in compiled output...');
    execSync(`${npmCmd} install "${rootDir}"`, {
      cwd: distDir,
      stdio: 'inherit',
    });

    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "await import('mcp-thing'); console.log('mcp-thing import ok');",
      ],
      {
        cwd: distDir,
        env: { ...process.env, NODE_OPTIONS: '' },
        encoding: 'utf-8',
      },
    );

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    expect(result.status).toBe(0);
    expect(output).not.toContain("Cannot find package 'mcp-thing'");
    expect(output).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(output).not.toContain('Fatal error');
  });
});
