# mcp-thing

Expose TypeScript classes as MCP (Model Context Protocol) tools over stdio.

`mcp-thing` is meant for quick MCP server development: write a class, add public
methods, and point the CLI at the directory. It parses your TypeScript source,
turns public methods into MCP tools, and serves them over stdin/stdout.

## Requirements

- Node.js 18+
- A TypeScript services directory
- `npm install` run in the services directory if your services import external dependencies

## Minimal service

```ts
// services/EchoService.ts
export class EchoService {
  /**
   * Returns the provided text.
   * @param text Text to return.
   */
  public echo(text: string): string {
    return text;
  }
}
```

Run it:

```sh
npx mcp-thing --run ./services
```

The exported MCP tool will be named `EchoService_echo`.

## Install

Install globally if you want the `mcpt` command:

```sh
npm install -g mcp-thing
```

## CLI

### Run

```sh
mcpt --run <servicesDir>
```

- `<servicesDir>` should be a TypeScript project directory (like `examples/`) containing your MCP services.
- Runs the MCP transport using the TypeScript services directory (it parses the `.ts` sources, not the compiled output).
- Transport: stdio only.

You can also omit `--run` and pass the services directory as the first positional argument:

```sh
mcpt ./services
```

### Compile

```sh
mcpt --compile <source> <dist?>
```

- `<source>` should be a TypeScript project directory (like `examples/`) containing your MCP services.
- Compiles TypeScript services into JavaScript output (defaults to `<source>/dist`).
- `<dist?>` is the compiled JavaScript output directory.

Example:

```sh
mcpt --compile ./services
cd ./services/dist
npm install
node index.js
```

This produces a standalone compiled server in `./services/dist`.

### Options

- `--server-name <name>` — overrides the MCP `serverInfo.name`
- `--server-version <version>` — overrides the MCP `serverInfo.version`
- `--verbose` — enables detailed stderr logs
- `--silent` — suppresses non-error stderr logs, including the startup notice

## MCP client config

Most MCP clients launch stdio servers with a command and args. For a global
install, use:

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "mcpt",
      "args": ["--run", "/absolute/path/to/services"]
    }
  }
}
```

With `npx`, use:

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "npx",
      "args": ["mcp-thing", "--run", "/absolute/path/to/services"]
    }
  }
}
```

For local iteration, `--run` is convenient because it reads the TypeScript
services directly. For MCP clients, a compiled build usually starts faster
because it can launch the generated JavaScript entrypoint directly.

For a compiled service build, point your client at the generated entrypoint:

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["/absolute/path/to/services/dist/index.js"]
    }
  }
}
```

## Tool discovery

Services and tools are discovered from your exported TypeScript classes:

- Exported classes are treated as services.
- Public methods are exposed as MCP tools.
- Private methods and constructors are ignored.

Tool metadata is derived from method names and JSDoc:

- The default tool name is `<ClassName>_<methodName>`.
- Use `@mcpToolName` in JSDoc to override the default tool name.
- Method JSDoc becomes the tool description.
- `@param` JSDoc becomes parameter descriptions.

Parameter schemas currently support:

- `string`, `number`, `boolean`, `T[]`, and `Array<T>`. Other types currently fall back to `string`.

Example:

```ts
export class GreetingService {
  /**
   * Greets a user.
   * @mcpToolName hello
   * @param name User name.
   */
  public greet(name: string): string {
    return `Hello, ${name}!`;
  }
}
```

## Server identity

You can also set `serverInfo.name` and `serverInfo.version` via class-level JSDoc on any exported service class:

```ts
/**
 * @mcpServerName My MCP Server
 * @mcpServerVersion 1.2.3
 */
export class MyService {}
```

CLI flags take precedence over JSDoc values.

## Examples

Check `examples/CalculatorService.ts` for a small service with server identity,
parameter descriptions, and a custom tool name.

## Development

```sh
npm run dev
npm run build
npm test
```
