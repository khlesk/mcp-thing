/**
 * A simple calculator service
 * @mcpServerName Example Calculator MCP
 * @mcpServerVersion 0.1.0
 */
export class CalculatorService {
  /**
   * Adds two numbers
   * @param a First number
   * @param b Second number
   */
  public add(a: number, b: number): number {
    return a + b;
  }

  /**
   * Subtracts two numbers
   * @param a Minuend
   * @param b Subtrahend
   */
  public subtract(a: number, b: number): number {
    return a - b;
  }

  /**
   * Greets a user
   * @mcpToolName friendly-greeting
   * @param name User's name
   * @param greeting Optional greeting message
   */
  public greet(name: string, greeting?: string): string {
    const message = this.formatGreeting(name, greeting);
    console.log(`Greeting sent: ${message}`);
    return message;
  }

  /**
   * This private method won't be exposed as an MCP tool
   * because only public methods are registered.
   */
  private formatGreeting(name: string, greeting?: string): string {
    return `${greeting || 'Hello'}, ${name}!`;
  }
}
