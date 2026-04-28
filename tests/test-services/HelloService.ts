import _ from 'lodash';

/**
 * A service that demonstrates external dependency usage.
 */
export class HelloService {
  /**
   * Says hello using lodash to capitalize the greeting.
   * @mcpToolName hello
   * @param name The name to greet.
   */
  public async sayHello(name: string): Promise<string> {
    return _.toUpper(`hello, ${name}!`);
  }
}
