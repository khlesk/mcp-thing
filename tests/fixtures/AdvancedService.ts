/**
 * Ignored helper class.
 * @mcpIgnore
 */
export class IgnoredService {
  public hidden(): string {
    return 'hidden';
  }
}

export class EmptyService {}

type SearchBy = 'name' | 'description';

enum SortBy {
  Name = 'name',
  Votes = 'votes',
}

interface SearchOptions {
  keyword: string;
  count?: number;
  by: SearchBy;
  sort: SortBy;
  tags: SearchBy[];
}

type SearchResult = {
  packages: string[];
  total: number;
  options: SearchOptions;
};

export class AdvancedService {
  /**
   * Searches packages.
   * @param keyword Search term
   * @minLength keyword 2
   * @param by Search field
   * @default by name
   * @param count Maximum result count
   * @minimum count 1
   * @maximum count 500
   * @default count 50
   */
  public search(
    keyword: string,
    by: 'name' | 'description' = 'name',
    count?: number,
  ): { packages: string[]; total: number } {
    return { packages: [keyword, by], total: count || 0 };
  }

  /**
   * @mcpIgnore
   */
  public ignoredMethod(): string {
    return 'ignored';
  }

  /**
   * Explains a package.
   * @mcpResultMode content
   */
  public explain(name: string): string {
    return name;
  }

  /**
   * Uses named simple types.
   * @param options Search options
   */
  public searchWithTypes(options: SearchOptions): SearchResult {
    return {
      packages: [],
      total: 0,
      options,
    };
  }
}
