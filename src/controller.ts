import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import { log } from './logger';

const BROWSER_DATA = path.join(process.cwd(), '.browser_data');

let context: BrowserContext | null = null;

export async function getBrowserContext(): Promise<BrowserContext> {
  if (context) return context;

  log.info('Launching persistent Chromium context...');
  context = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  // Stealth: mask webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
  });

  log.info('Browser context ready');
  return context;
}

export async function getPage(url?: string): Promise<Page> {
  const ctx = await getBrowserContext();
  const pages = ctx.pages();
  let page = pages.length > 0 ? pages[0] : await ctx.newPage();

  if (url && page.url() !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  return page;
}

export async function newPage(url?: string): Promise<Page> {
  const ctx = await getBrowserContext();
  const page = await ctx.newPage();

  if (url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  return page;
}

export async function closeBrowser(): Promise<void> {
  if (context) {
    try {
      await context.close();
    } catch (e) {
      log.error('Error closing browser:', e);
    }
    context = null;
    log.info('Browser closed');
  }
}
