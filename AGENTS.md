# Repository Guidelines

## Project Structure & Module Organization

- `src/` — TypeScript source (ESM / NodeNext).
  - `src/cli.ts` — CLI entrypoint (`mcpt`).
  - `src/core/` — runtime modules: AST parsing, schema building, service container, transport, compiler, logger.
  - `src/index.ts` — library exports.
- `examples/` — sample services (not compiled by the main build).
- `tests/` — Jest + ts-jest unit/integration tests (includes `tests/test-services/` for e2e/compile workflows).
- `dist/` — build output from `npm run build` (generated).

## Testing Guidelines

- Framework: Jest (`ts-jest`).
- Add/adjust tests when changing CLI behavior, transport protocol behavior, compiler output, or AST parsing.
- Prefer deterministic tests (avoid relying on filesystem traversal order).

## Linting & Formatting

- Tool: Biome.
- `npm run check` — runs all Biome checks (lint + format).
- `npm run check:fix` — auto-fixes lint and format issues.
- `npm run lint:check` — checks lint only.
- `npm run lint:fix` — auto-fixes lint issues.
- `npm run format:check` — checks format only.
- `npm run format:fix` — auto-fixes format issues.
