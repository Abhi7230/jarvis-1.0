import { getPageForUser } from '../browser-pool';
import { log } from '../logger';

const SHORTCUTS: Record<string, string> = {
  'feed':                'https://www.linkedin.com/feed/',
  'home':                'https://www.linkedin.com/feed/',
  'my profile':          'https://www.linkedin.com/in/me/',
  'profile':             'https://www.linkedin.com/in/me/',
  'my connections':      'https://www.linkedin.com/mynetwork/invite-connect/connections/',
  'connections':         'https://www.linkedin.com/mynetwork/invite-connect/connections/',
  'my network':          'https://www.linkedin.com/mynetwork/',
  'network':             'https://www.linkedin.com/mynetwork/',
  'notifications':       'https://www.linkedin.com/notifications/',
  'messaging':           'https://www.linkedin.com/messaging/',
  'messages':            'https://www.linkedin.com/messaging/',
  'jobs':                'https://www.linkedin.com/jobs/',
  'my posts':            'https://www.linkedin.com/in/me/recent-activity/',
  'saved posts':         'https://www.linkedin.com/my-items/saved-posts/',
  'settings':            'https://www.linkedin.com/psettings/',
  'who viewed me':       'https://www.linkedin.com/me/profile-views/',
  'profile views':       'https://www.linkedin.com/me/profile-views/',
  'invitations':         'https://www.linkedin.com/mynetwork/invitation-manager/',
  'pending invitations': 'https://www.linkedin.com/mynetwork/invitation-manager/',
};

function resolveUrl(input: string): string | null {
  const lower = input.trim().toLowerCase();

  // Check shortcuts
  if (SHORTCUTS[lower]) return SHORTCUTS[lower];

  // Already a URL
  if (input.startsWith('http')) {
    if (!input.includes('linkedin.com')) return null;
    return input;
  }

  // Try as a path
  if (input.startsWith('/')) {
    return `https://www.linkedin.com${input}`;
  }

  return null;
}

// Text extraction + cleanup script (string-based to avoid esbuild __name issue)
const EXTRACT_SCRIPT = `(function() {
  var main = document.querySelector('.scaffold-layout__main')
    || document.querySelector('main')
    || document.querySelector('[role="main"]')
    || document.body;

  var text = main.innerText || '';

  // Line-by-line cleanup
  var lines = text.split('\\n');
  var cleaned = [];
  var skipWords = ['like', 'comment', 'share', 'repost', 'send', 'love', 'celebrate', 'support', 'insightful', 'funny'];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.length < 3) continue;
    if (skipWords.indexOf(line.toLowerCase()) !== -1) continue;
    cleaned.push(line);
  }

  return cleaned.join('\\n');
})()`;

export async function linkedinBrowse(
  urlOrShortcut: string,
  userId: string = '__legacy__'
): Promise<string> {
  const url = resolveUrl(urlOrShortcut);

  if (!url) {
    const shortcuts = Object.keys(SHORTCUTS)
      .filter((k, i, arr) => arr.indexOf(k) === i)
      .slice(0, 15)
      .join(', ');
    return `Could not resolve "${urlOrShortcut}". Pass a LinkedIn URL or a shortcut keyword: ${shortcuts}`;
  }

  try {
    log.info(`linkedin_browse: navigating to ${url}`);
    const page = await getPageForUser(userId, url);
    await page.waitForTimeout(3000);

    // Check if redirected to login
    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      return 'Not logged in to LinkedIn. Use /login_linkedin first.';
    }

    const text: string = await page.evaluate(EXTRACT_SCRIPT) as string;

    if (!text || text.length < 20) {
      return 'Could not extract content from this page. It may still be loading or requires login.';
    }

    // Smart truncation at line boundary
    if (text.length <= 1800) return text;

    const truncated = text.slice(0, 1800);
    const lastNewline = truncated.lastIndexOf('\n');
    return (lastNewline > 1000 ? truncated.slice(0, lastNewline) : truncated) + '\n... [page content truncated]';
  } catch (e: any) {
    log.error('linkedin_browse error:', e.message);
    return `Error browsing LinkedIn: ${e.message}`;
  }
}
