# Changelog

## 0.3.1

- Added `@mcpAnnotations` for tool titles and behavior hints, preserved in compiled manifests and `tools/list` responses.
- Disabled source and declaration map generation and excluded maps from the npm package.
- Fixed the E2E test to use the public `tsx` loader and corrected test formatting.

## 0.3.0

- Migrated stdio transport to `@modelcontextprotocol/server` v2, with MCP `2026-07-28` support and legacy protocol negotiation.
- Added JSON text blocks alongside structured tool results so text-only clients receive the same data.
- Added private 60-second cache hints to modern `tools/list` responses.
- Sorted tools by name for stable discovery results.

## 0.2.1

- Added support for using a single TypeScript service file as the CLI source for both `--run` and `--compile`.
- Updated source path handling so file sources resolve `tsconfig.json`, dependency checks, and default compile output from the file's parent directory.

## 0.2.0

- Added structured tool results by default, with `--result-mode content` and `@mcpResultMode content` for text-only clients.
- Added inferred output schemas for simple return types.
- Expanded input schema inference for optional/nullish types, literal unions, enums, arrays, interfaces, type aliases, and simple object shapes.
- Added optional JSDoc schema constraints such as `@minimum`, `@maximum`, `@minLength`, `@default`, `@pattern`, and `@format`.
- Added `@mcpIgnore` support for exported helper classes and public methods.
- Updated compiled server generation to preserve configured server identity and result mode.
