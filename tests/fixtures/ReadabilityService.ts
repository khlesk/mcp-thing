interface ArticleResult {
  url: string;
  title?: string;
  text?: string;
  error?: string;
}

// Deterministic extraction results for transport compatibility tests.
export class ReadabilityService {
  /** @mcpToolName readability */
  public extractArticles(urls: string[]): ArticleResult[] {
    if (urls.includes('tool-error')) throw new Error('Extraction failed');
    return urls.map((url) =>
      url.endsWith('/missing')
        ? { url, error: 'Article not found' }
        : { url, title: 'Example article', text: 'Article body' },
    );
  }
}
