import { getSharedPage } from '../browser-pool';
import { log } from '../logger';

const BLOCKED_PATTERNS = [
  /^file:/i,
  /localhost/i,
  /127\.0\.0\.1/,
  /10\.\d+\.\d+\.\d+/,
  /192\.168\./,
  /172\.(1[6-9]|2\d|3[01])\./,
  /0\.0\.0\.0/,
];

function isSafeUrl(url: string): boolean {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

const EXTRACT_SCRIPT = `(function() {
  var main = document.querySelector('main')
    || document.querySelector('[role="main"]')
    || document.querySelector('article')
    || document.querySelector('.content')
    || document.body;

  var text = main.innerText || '';

  var lines = text.split('\\n');
  var cleaned = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.length < 3) continue;
    cleaned.push(line);
  }

  return cleaned.join('\\n');
})()`;

export async function webBrowse(url: string): Promise<string> {
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }

  if (!isSafeUrl(url)) {
    return 'Blocked: cannot browse local or internal URLs.';
  }

  try {
    log.info(`web_browse: navigating to ${url}`);
    const page = await getSharedPage(url);
    await page.waitForTimeout(3000);

    const text: string = await page.evaluate(EXTRACT_SCRIPT) as string;

    if (!text || text.length < 20) {
      return 'Could not extract content from this page. It may be empty or blocked.';
    }

    // Prepend page title for context
    const title = await page.title();
    const header = title ? `**${title}**\n\n` : '';
    const content = header + text;

    if (content.length <= 1800) return content;

    const truncated = content.slice(0, 1800);
    const lastNewline = truncated.lastIndexOf('\n');
    return (lastNewline > 1000 ? truncated.slice(0, lastNewline) : truncated) + '\n... [page content truncated]';
  } catch (e: any) {
    log.error('web_browse error:', e.message);
    return `Error browsing page: ${e.message}`;
  }
}
