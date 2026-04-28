export interface LoggerOptions {
  verbose?: boolean;
  silent?: boolean;
}

export class Logger {
  private verbose: boolean;
  private silent: boolean;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose ?? false;
    this.silent = options.silent ?? false;
  }

  public info(message: string): void {
    if (this.silent) return;
    if (!this.verbose) return;
    this.write(`[mcp-thing] ${message}`);
  }

  public warn(message: string): void {
    if (this.silent) return;
    if (!this.verbose) return;
    this.write(`[mcp-thing] Warning: ${message}`);
  }

  public error(message: string, error?: unknown): void {
    if (error === undefined) {
      this.write(`[mcp-thing] ${message}`);
      return;
    }
    this.write(`[mcp-thing] ${message}`, error);
  }

  public started(toolNames: string[]): void {
    if (this.silent) return;
    const list = toolNames.length > 0 ? toolNames.join(', ') : '(none)';
    this.write(
      `[mcp-thing] Started MCP server on stdio with ${toolNames.length} tools: ${list}`,
    );
  }

  private write(message: string, error?: unknown): void {
    if (error === undefined) {
      console.error(message);
      return;
    }
    console.error(message, error);
  }
}
