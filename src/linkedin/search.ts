import { getPageForUser } from '../browser-pool';
import { upsertRecruiter } from '../db/schema';
import { log } from '../logger';

interface SearchResult {
  name: string;
  profileUrl: string;
  headline?: string;
  location?: string;
  connectionDegree?: string;
}

export async function linkedinSearch(
  query: string,
  maxResults: number = 10,
  userId: string = '__legacy__'
): Promise<SearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodedQuery}&origin=GLOBAL_SEARCH_HEADER`;

  const page = await getPageForUser(userId, searchUrl);
  await page.waitForTimeout(3000);

  // Check if we're on login page
  if (page.url().includes('/login') || page.url().includes('/authwall')) {
    log.warn('LinkedIn: not logged in, cannot search');
    return [];
  }

  // Scroll down to load more results
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(1500);
  }

  // Strategy A: DOM scrape with multiple selector approaches
  let results = await strategyA(page, maxResults);

  // Strategy B: fallback raw HTML regex
  if (results.length === 0) {
    log.info('LinkedIn search: Strategy A returned 0, trying Strategy B');
    results = await strategyB(page, maxResults);
  }

  // Strategy C: get all links + text near them
  if (results.length === 0) {
    log.info('LinkedIn search: Strategy B returned 0, trying Strategy C');
    results = await strategyC(page, maxResults);
  }

  // Save all results to DB
  for (const r of results) {
    upsertRecruiter(userId, {
      name: r.name,
      profile_url: r.profileUrl,
      headline: r.headline,
      location: r.location,
      connection_degree: r.connectionDegree,
    });
  }

  log.info(`LinkedIn search for "${query}": found ${results.length} results`);
  return results;
}

async function strategyA(page: any, maxResults: number): Promise<SearchResult[]> {
  try {
    const results: SearchResult[] = await page.evaluate((max: number) => {
      const items: any[] = [];

      // Try multiple container selectors (LinkedIn keeps changing these)
      const containerSelectors = [
        'li.reusable-search__result-container',
        '.entity-result__item',
        '.entity-result',
        '[data-chameleon-result-urn]',
        'li[class*="search-result"]',
        'div[data-view-name="search-entity-result-universal-template"]',
      ];

      let containers: Element[] = [];
      for (const sel of containerSelectors) {
        const found = document.querySelectorAll(sel);
        if (found.length > 0) {
          containers = Array.from(found);
          break;
        }
      }

      for (const container of containers) {
        if (items.length >= max) break;

        // Extract profile link first (most reliable)
        const allLinks = container.querySelectorAll('a[href*="/in/"]');
        let profileUrl = '';
        let linkText = '';

        for (const link of Array.from(allLinks)) {
          const href = (link as HTMLAnchorElement).href;
          if (href && href.includes('/in/') && !href.includes('/in/unavailable')) {
            const match = href.match(/(https:\/\/www\.linkedin\.com\/in\/[^/?]+)/);
            if (match) {
              profileUrl = match[1];
              linkText = link.textContent?.trim() || '';
              break;
            }
          }
        }

        if (!profileUrl) continue;

        // Extract name from various possible elements
        const nameSelectors = [
          'span[aria-hidden="true"]',
          '.entity-result__title-text a span',
          'a[href*="/in/"] span[dir="ltr"]',
          'a[href*="/in/"] span',
        ];

        let name = '';
        for (const sel of nameSelectors) {
          const el = container.querySelector(sel);
          const text = el?.textContent?.trim();
          if (text && text.length > 1 && text.length < 80 && !text.includes('LinkedIn')) {
            name = text;
            break;
          }
        }

        // Fallback: use link text
        if (!name && linkText) {
          name = linkText.split('\n')[0].trim();
        }

        if (!name) continue;

        // Extract headline
        const headlineSelectors = [
          '.entity-result__primary-subtitle',
          '.t-14.t-black.t-normal',
          '[class*="subtitle"]',
        ];
        let headline = '';
        for (const sel of headlineSelectors) {
          const el = container.querySelector(sel);
          if (el?.textContent?.trim()) {
            headline = el.textContent.trim();
            break;
          }
        }

        // Extract location
        const locationSelectors = [
          '.entity-result__secondary-subtitle',
          '.t-14.t-normal:not(.t-black)',
        ];
        let location = '';
        for (const sel of locationSelectors) {
          const el = container.querySelector(sel);
          if (el?.textContent?.trim()) {
            location = el.textContent.trim();
            break;
          }
        }

        items.push({ name, profileUrl, headline, location });
      }

      return items;
    }, maxResults);

    return results;
  } catch (e: any) {
    log.error('LinkedIn Strategy A error:', e.message);
    return [];
  }
}

async function strategyB(page: any, maxResults: number): Promise<SearchResult[]> {
  try {
    const html = await page.content();
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    const regex = /https:\/\/www\.linkedin\.com\/in\/([a-zA-Z0-9\-]+)/g;
    let match;

    while ((match = regex.exec(html)) !== null && results.length < maxResults) {
      const slug = match[1];
      const profileUrl = `https://www.linkedin.com/in/${slug}`;

      if (seen.has(profileUrl)) continue;
      seen.add(profileUrl);

      if (slug === 'unavailable' || slug.length < 3) continue;

      // Derive name from slug
      const name = slug
        .replace(/-\d+$/, '')
        .replace(/-[a-f0-9]{6,}$/i, '') // remove hex suffixes
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      results.push({ name, profileUrl });
    }

    return results;
  } catch (e: any) {
    log.error('LinkedIn Strategy B error:', e.message);
    return [];
  }
}

async function strategyC(page: any, maxResults: number): Promise<SearchResult[]> {
  try {
    // Get all links to /in/ profiles with surrounding text
    const results: SearchResult[] = await page.evaluate((max: number) => {
      const items: any[] = [];
      const seen = new Set<string>();
      const links = document.querySelectorAll('a[href*="/in/"]');

      for (const link of Array.from(links)) {
        if (items.length >= max) break;

        const href = (link as HTMLAnchorElement).href;
        const match = href.match(/(https:\/\/www\.linkedin\.com\/in\/[^/?]+)/);
        if (!match) continue;

        const profileUrl = match[1];
        if (seen.has(profileUrl) || profileUrl.includes('unavailable')) continue;
        seen.add(profileUrl);

        // Get name from link text or nearest parent
        let name = link.textContent?.trim() || '';
        if (!name || name.length < 2) {
          // Look at parent's text
          const parent = link.closest('li, div[class*="result"], div[class*="entity"]');
          if (parent) {
            const span = parent.querySelector('span[aria-hidden="true"]');
            name = span?.textContent?.trim() || '';
          }
        }

        // Clean up name
        name = name.split('\n')[0].trim();
        if (name.length < 2 || name.length > 80) continue;

        items.push({ name, profileUrl });
      }

      return items;
    }, maxResults);

    return results;
  } catch (e: any) {
    log.error('LinkedIn Strategy C error:', e.message);
    return [];
  }
}

export async function linkedinGetProfile(profileUrl: string, userId: string = '__legacy__'): Promise<string> {
  try {
    // Normalize URL
    if (!profileUrl.startsWith('http')) {
      profileUrl = `https://www.linkedin.com${profileUrl.startsWith('/') ? '' : '/'}${profileUrl}`;
    }

    const page = await getPageForUser(userId, profileUrl);
    await page.waitForTimeout(4000);

    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      return 'Not logged in to LinkedIn.';
    }

    const profile = await page.evaluate(() => {
      const getText = (selectors: string[]): string => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return '';
      };

      const name = getText([
        'h1.text-heading-xlarge',
        'h1[class*="heading"]',
        '.top-card-layout__title',
        'h1',
      ]) || 'Unknown';

      const headline = getText([
        '.text-body-medium.break-words',
        'div[class*="text-body-medium"]',
        '.top-card-layout__headline',
      ]);

      const location = getText([
        '.text-body-small.inline.t-black--light.break-words',
        'span.text-body-small[class*="t-black--light"]',
        '.top-card-layout__first-subline',
      ]);

      const about = getText([
        '.pv-about__summary-text span[aria-hidden="true"]',
        'section.summary .core-section-container__content',
        '#about ~ div span[aria-hidden="true"]',
      ]);

      const experiences: string[] = [];
      document
        .querySelectorAll(
          '#experience ~ .pvs-list__outer-container li.artdeco-list__item, .experience-section li, [id*="experience"] li'
        )
        .forEach((el, i) => {
          if (i < 3) {
            const text = el.textContent?.replace(/\s+/g, ' ').trim() || '';
            if (text) experiences.push(text.slice(0, 200));
          }
        });

      // Get connection degree
      const connectionInfo = getText([
        '.dist-value',
        'span[class*="distance-badge"]',
        '.pv-top-card--list span.text-body-small',
      ]);

      return { name, headline, location, about: about.slice(0, 500), experiences, connectionInfo };
    });

    upsertRecruiter(userId, {
      name: profile.name,
      profile_url: profileUrl,
      headline: profile.headline,
      location: profile.location,
    });

    let result = `*${profile.name}*\n${profile.headline}\n📍 ${profile.location}`;
    if (profile.connectionInfo) result += `\n🔗 ${profile.connectionInfo}`;
    if (profile.about) result += `\n\nAbout: ${profile.about}`;
    if (profile.experiences.length > 0) {
      result += `\n\nRecent experience:\n${profile.experiences.map((e: string) => `• ${e}`).join('\n')}`;
    }

    return result;
  } catch (e: any) {
    log.error('LinkedIn get profile error:', e.message);
    return `Error fetching profile: ${e.message}`;
  }
}
