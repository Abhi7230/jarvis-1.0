import { getSharedPage } from '../browser-pool';
import { log } from '../logger';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function webSearch(query: string, maxResults: number = 8): Promise<string> {
  if (!query) return 'Please provide a search query.';
  maxResults = Math.max(1, Math.min(Number(maxResults) || 8, 20));

  try {
    const encoded = encodeURIComponent(query);
    const searchUrl = `https://www.google.com/search?q=${encoded}&hl=en`;

    log.info(`web_search: "${query}"`);
    const page = await getSharedPage(searchUrl);
    await page.waitForTimeout(2000);

    const results: SearchResult[] = await page.evaluate(`(function() {
      var items = [];
      var containers = document.querySelectorAll('div.g, div[data-sokoban-container]');

      for (var i = 0; i < Math.min(containers.length, ${maxResults}); i++) {
        var container = containers[i];

        var linkEl = container.querySelector('a[href^="http"]');
        if (!linkEl) continue;
        var url = linkEl.href;

        var titleEl = container.querySelector('h3');
        var title = titleEl ? titleEl.textContent.trim() : '';
        if (!title) continue;

        var snippetEl = container.querySelector('div[data-sncf], div[style*="-webkit-line-clamp"], span.aCOpRe, div.VwiC3b');
        var snippet = snippetEl ? snippetEl.textContent.trim() : '';

        items.push({ title: title, url: url, snippet: snippet.slice(0, 200) });
      }

      return items;
    })()`) as SearchResult[];

    if (results.length === 0) {
      // Fallback: try to get any useful text from the page
      const text = await page.evaluate(`(function() {
        var main = document.querySelector('#search') || document.body;
        return main.innerText.slice(0, 1500);
      })()`) as string;
      return text || 'No search results found.';
    }

    const formatted = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.url}${r.snippet ? '\n   ' + r.snippet : ''}`
    ).join('\n\n');

    log.info(`web_search: found ${results.length} results for "${query}"`);
    return formatted;
  } catch (e: any) {
    log.error('web_search error:', e.message);
    return `Error searching: ${e.message}`;
  }
}
