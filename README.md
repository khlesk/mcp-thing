# mcp-thing

Expose TypeScript classes as MCP (Model Context Protocol) tools over stdio.

`mcp-thing` is the fast, easy way to create a fully working MCP service: write
TypeScript classes, export them, and point the CLI at one service file or a
directory of services. Public methods become MCP tools, JSDoc becomes tool
documentation, and TypeScript types become MCP JSON schemas.

## Requirements

- Node.js 20+
- A TypeScript service file or services directory
- `npm install` in the service source directory if your services import dependencies

## Quick Start With npx

Create a service:

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
npx mcp-thing --run ./services/EchoService.ts
```

The exported tool is named `EchoService_echo`.

## Install

Install globally if you want the `mcpt` command available everywhere:

```sh
npm install -g mcp-thing
```

Run a service file or services directory:

```sh
mcpt --run ./services/EchoService.ts
mcpt --run ./services
```

You can omit `--run` and pass the source directly:

```sh
mcpt ./services/EchoService.ts
mcpt ./services
```

## Compile

Compile a TypeScript service file or services directory into a standalone
JavaScript MCP server. For best startup performance in MCP clients, compile your
service and run the generated JavaScript entrypoint instead of parsing
TypeScript on every launch:

```sh
mcpt --compile ./services/EchoService.ts
mcpt --compile ./services
```

By default this writes to `dist` inside the source directory, or the parent
directory when the source is a file. You can provide a custom output directory:

```sh
mcpt --compile ./services/EchoService.ts ./build/mcp
mcpt --compile ./services ./build/mcp
```

Run the compiled server:

```sh
cd ./services/dist
npm install
node index.js
```

Compiled output includes:

- `index.js` — generated MCP server entrypoint
- `schema-manifest.json` — discovered services, tools, schemas, and result modes
- emitted service `.js` files
- `package.json` with the runtime dependency on `mcp-thing`

## CLI Options

- `--server-name <name>` — override MCP `serverInfo.name`
- `--server-version <version>` — override MCP `serverInfo.version`
- `--result-mode <structured|content>` — choose global successful result format
- `--verbose` — enable detailed stderr logs
- `--silent` — suppress non-error stderr logs, including startup notice

The default result mode is `structured`.

## MCP Client Config

Most MCP clients launch stdio servers with a command and args.

With `npx`:

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

With a global install:

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

With compiled output:

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

Use `--run` while iterating locally. Use compiled output when you want a faster,
plain JavaScript startup path for MCP clients.

## Protocol versions and transport

Both run mode and compiled servers use stdio. Each protocol message is one JSON
line on stdout. Framework diagnostics go to stderr. Service methods must also
write diagnostics to stderr so they do not corrupt the protocol stream.

The transport uses the released `@modelcontextprotocol/server` v2 SDK and supports
[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).
Modern clients can call `server/discover` or invoke tools directly without an
initialization handshake. Each modern request includes protocol metadata in
`params._meta`, for example:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "EchoService_echo",
    "arguments": { "text": "hello" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "my-client",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

Older clients use `initialize` followed by `notifications/initialized`. The SDK
negotiates `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, and `2024-10-07`.
If the requested legacy version is unsupported, the initialization response
offers the SDK's preferred supported legacy version. Unsupported modern
versions receive error `-32022` with the supported versions.

There are no transport flags or HTTP listener. Remote hosting is outside the
current scope. Compiled services use the same stdio transport as run mode.

For MCP `2026-07-28`, `tools/list` responses include `ttlMs: 60000` and
`cacheScope: "private"`. Clients can reuse the tool list for 60 seconds within
the same authorization context. Tools are sorted by name for stable ordering.
These hints do not cache tool execution results. Legacy responses omit the hints.

## Tool Discovery

Tools are discovered from exported TypeScript classes:

- Exported classes are services.
- Public methods are tools.
- Private methods and constructors are ignored.
- Classes with no exposed methods are skipped.
- Use `@mcpIgnore` to skip an exported helper class or a public method.

```ts
/**
 * @mcpIgnore
 */
export class HelperError extends Error {}

export class PackageService {
  /**
   * @mcpIgnore
   */
  public internalDebug(): string {
    return 'debug';
  }
}
```

Tool metadata comes from names and JSDoc:

- Default tool name: `<ClassName>_<methodName>`
- `@mcpToolName <name>` overrides the tool name
- Method JSDoc description becomes the MCP tool description
- `@param` descriptions become parameter descriptions

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

## Tool annotations

Use `@mcpAnnotations` with a JSON object to describe a tool to MCP clients:

```ts
/**
 * Read the current status.
 * @mcpAnnotations {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}
 */
public status(): string { return 'ready'; }
```

Supported properties are `title` as a string and `readOnlyHint`,
`destructiveHint`, `idempotentHint`, and `openWorldHint` as booleans.
Invalid values fail parsing. The compiler preserves annotations in the manifest,
and the transport includes them in `tools/list`. These are client hints, not
permission checks.

## Input Schemas

`mcp-thing` infers MCP input schemas from TypeScript method parameters.

Supported inference includes:

- `string`, `number`, `boolean`
- optional parameters like `count?: number`
- optional/nullish unions like `number | undefined` and `string | null`
- arrays like `string[]` and `Array<number>`
- literal unions as enums, like `'name' | 'description'`
- named type aliases for simple supported types
- TypeScript enums and const enums with string or number values
- plain object, type alias, and interface shapes with simple properties
- recursive array item schemas, including enum arrays

Unsupported complex types degrade to a simpler schema and produce a warning
instead of silently pretending the schema is precise.

```ts
export class SearchService {
  /**
   * Searches packages.
   * @param keyword Search term.
   * @param by Search field.
   * @param count Maximum number of results.
   */
  public search(
    keyword: string,
    by: 'name' | 'description' = 'name',
    count?: number,
  ) {
    return { packages: [], total: 0 };
  }
}
```

This exposes `by` as a string enum and `count` as an optional number.

Named simple types work too:

```ts
type SearchBy = 'name' | 'description' | 'maintainer';

enum SortBy {
  Name = 'name',
  Votes = 'votes',
}

interface SearchOptions {
  keyword: string;
  by: SearchBy;
  sort: SortBy;
  count?: number;
}

export class SearchService {
  public search(options: SearchOptions) {
    return { packages: [], total: 0 };
  }
}
```

This exposes `options` as an object schema, `by` and `sort` as enums, and
`count` as an optional number.

Intentionally unsupported complex TypeScript features include generics, mapped
types, conditional types, recursive types, inheritance-heavy classes, and
utility types like `Partial<T>`, `Pick<T>`, and `Record<K, V>`.

## Optional Schema Constraints

You can enrich inferred input schemas with optional JSDoc tags. These tags are
not required; use them only when clients should discover validation details.

Supported parameter constraint tags:

- `@minLength <param> <number>`
- `@maxLength <param> <number>`
- `@minimum <param> <number>`
- `@maximum <param> <number>`
- `@exclusiveMinimum <param> <number>`
- `@exclusiveMaximum <param> <number>`
- `@default <param> <value>`
- `@minItems <param> <number>`
- `@maxItems <param> <number>`
- `@pattern <param> <regex>`
- `@format <param> <format>`

Example:

```ts
export class AurService {
  /**
   * Searches AUR packages.
   * @param keyword Search term.
   * @minLength keyword 2
   * @param by Search field.
   * @default by name
   * @param count Maximum result count.
   * @minimum count 1
   * @maximum count 500
   * @default count 50
   */
  public search(
    keyword: string,
    by: 'name' | 'description' | 'maintainer' = 'name',
    count?: number,
  ) {
    return { packages: [], total: 0 };
  }
}
```

Clients will see `keyword.minLength`, `by.enum`, `by.default`, `count.minimum`,
`count.maximum`, and `count.default` in the input schema.

## Output Schemas

`mcp-thing` also infers output schemas from simple return types, including
plain object aliases and interfaces.

```ts
public packageInfo(name: string): { name: string; version: string } {
  return { name, version: '1.0.0' };
}
```

This emits an MCP `outputSchema` for:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "version": { "type": "string" }
  },
  "required": ["name", "version"]
}
```

Primitive and array returns are wrapped as `{ "result": value }` in structured
responses, so their output schemas are wrapped the same way.

```ts
public names(): string[] {
  return ['yay', 'paru'];
}
```

Produces structured content shaped like:

```json
{
  "result": ["yay", "paru"]
}
```

Complex return types may still be returned as structured data at runtime, but
`outputSchema` is only emitted when the shape is simple enough to infer.

## Tool Results

Successful tool calls default to structured MCP results with a JSON text block:

```ts
public info(name: string) {
  return { name, version: '1.0.0' };
}
```

Default MCP result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"name\": \"yay\",\n  \"version\": \"1.0.0\"\n}"
    }
  ],
  "structuredContent": {
    "name": "yay",
    "version": "1.0.0"
  }
}
```

The text block contains the JSON serialization of `structuredContent`. Text-only
clients and structured clients receive the same data, including the
`{ "result": [...] }` wrapper for arrays. The advertised `outputSchema` describes
`structuredContent`. Per-item failures and their messages remain in both
representations.

Return behavior in structured mode:

- plain objects become `structuredContent` as-is
- strings, numbers, booleans, arrays, and null are wrapped as `{ "result": value }`
- `undefined` becomes empty structured content `{}`
- thrown errors become `{ isError: true, content: [{ type: "text", text: message }] }`

### Content Mode

Use content mode to return only text content without `structuredContent`.

Globally:

```sh
mcpt --run ./services --result-mode content
```

Per tool:

```ts
export class ExplainService {
  /**
   * Explains a package.
   * @mcpResultMode content
   */
  public explain(name: string): string {
    return `Package ${name} is maintained by ...`;
  }
}
```

In content mode, `structuredContent` is omitted and non-string values are
serialized as JSON text.

### Explicit ToolResult

Most methods should return normal values. For advanced cases, a method can
return a full MCP-style tool result to control `content`, `structuredContent`,
and `isError` directly.

```ts
import type { ToolResult } from 'mcp-thing';

export class ImportService {
  public importPackages(): ToolResult {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Imported 8 packages, failed 2.' }],
      structuredContent: {
        imported: 8,
        failed: ['pkg-a', 'pkg-b'],
      },
    };
  }
}
```

Explicit results preserve their content blocks, error flag, and metadata. If an
explicit result has `structuredContent` and no content blocks, the transport adds
a JSON text block containing that structured data.

This is optional and mainly useful for partial success or custom error
formatting. For normal failures, throw an error.

## Server Identity

Set `serverInfo.name` and `serverInfo.version` with class-level JSDoc:

```ts
/**
 * @mcpServerName My MCP Server
 * @mcpServerVersion 1.2.3
 */
export class MyService {
  public ping(): string {
    return 'pong';
  }
}
```

CLI flags take precedence over JSDoc values.

## Examples

See `examples/CalculatorService.ts` for a small service with server identity,
parameter descriptions, and a custom tool name.

A project using `mcp-thing` that can serve as a reference:

- [mcp-readability](https://github.com/khlesk/mcp-readability)
