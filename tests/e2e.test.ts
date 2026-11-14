import { execSync, spawn } from 'node:child_process';
import path from 'node:path';

const projectRoot = process.cwd();
const cliTs = path.resolve(projectRoot, 'src', 'cli.ts');
const testServicesDir = path.resolve(projectRoot, 'tests', 'test-services');

describe('E2E External Services', () => {
  let serverProcess: any;
  jest.setTimeout(60000);

  beforeAll((done) => {
    // Ensure dependencies are installed in the test services directory
    try {
      execSync('npm install', { cwd: testServicesDir, stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to run npm install in test-services:', err);
      return done(err);
    }

    // We use tsx to run the CLI directly
    serverProcess = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        cliTs,
        '--server-name',
        'E2E Server',
        '--server-version',
        '3.3.3',
        testServicesDir,
      ],
      {
        cwd: projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      },
    );

    // Wait for server to start
    let combinedOutput = '';
    let ready = false;
    const onReadyData = (data: Buffer) => {
      combinedOutput += data.toString();
      if (combinedOutput.includes('Started MCP server')) {
        ready = true;
        serverProcess.stdout.removeListener('data', onReadyData);
        serverProcess.stderr.removeListener('data', onReadyData);
        done();
      }
    };
    serverProcess.stderr.on('data', onReadyData);
    serverProcess.stdout.on('data', onReadyData);

    serverProcess.on('error', (err: any) => {
      console.error('Failed to start server process:', err);
      done(err);
    });

    serverProcess.on('exit', (code: number | null) => {
      if (!ready) {
        done(
          new Error(
            `Server exited before ready (code ${code}). Output:\n${combinedOutput}`,
          ),
        );
      }
    });
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  const sendRequest = (request: any): Promise<any> => {
    return new Promise((resolve, _reject) => {
      const onData = (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            try {
              const response = JSON.parse(line);
              if (response.id === request.id) {
                serverProcess.stdout.removeListener('data', onData);
                resolve(response);
                return;
              }
            } catch (_e) {
              // Ignore non-json or partial lines
            }
          }
        }
      };
      serverProcess.stdout.on('data', onData);
      serverProcess.stdin.write(`${JSON.stringify(request)}\n`);
    });
  };

  it('should initialize successfully', async () => {
    const response = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    expect(response.result).toBeDefined();
    expect(response.result.protocolVersion).toBe('2024-11-05');
    expect(response.result.serverInfo).toEqual({
      name: 'E2E Server',
      version: '3.3.3',
    });
  });

  it('should list tools including the custom tool name', async () => {
    const response = await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeDefined();
    const toolNames = response.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('hello');
  });

  it('should call the custom tool name and use lodash (uppercase)', async () => {
    const response = await sendRequest({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'hello',
        arguments: { name: 'world' },
      },
    });

    expect(response.result).toBeDefined();
    expect(response.result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify(response.result.structuredContent, null, 2),
      },
    ]);
    expect(response.result.structuredContent).toEqual({
      result: 'HELLO, WORLD!',
    });
  });
});
