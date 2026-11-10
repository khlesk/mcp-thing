import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AstParser } from '../src/core/ast-parser';

describe('tool annotations', () => {
  it('preserves supported hints in generated metadata and rejects malformed hints', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcpt-annotations-'));
    const file = join(directory, 'service.ts');
    try {
      writeFileSync(
        file,
        `export class Service {
        /** @mcpAnnotations {"readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false} */
        public inspect(): string { return 'ok'; }
      }`,
      );
      const parser = new AstParser(join(process.cwd(), 'tsconfig.json'));
      expect(parser.parseServiceFiles(file)[0].methods[0].annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      writeFileSync(
        file,
        `export class Service {
        /** @mcpAnnotations {"readOnlyHint":"yes"} */
        public inspect(): string { return 'ok'; }
      }`,
      );
      expect(() => parser.parseServiceFiles(file)).toThrow(
        'Invalid mcpAnnotations entry',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
