# Changelog

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
