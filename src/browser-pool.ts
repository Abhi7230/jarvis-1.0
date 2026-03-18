import { chromium, BrowserContext, Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { log } from './logger';

const BROWSER_BASE = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'browsers');
const MAX_SLOTS = Number(process.env.BROWSER_POOL_SIZE) || 3;

interface BrowserSlot {
  context: BrowserContext;
  userId: string;
  lastUsed: number;
  dataDir: string;
}

const slots: BrowserSlot[] = [];
const queue: { userId: string; resolve: (ctx: BrowserContext) => void; reject: (e: Error) => void }[] = [];

async function launchContext(userId: string): Promise<BrowserContext> {
  const dataDir = path.join(BROWSER_BASE, userId);
  fs.mkdirSync(dataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(dataDir, {
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

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  return context;
}

async function evictLRU(): Promise<void> {
  if (slots.length === 0) return;
  let oldest = slots[0];
  for (const slot of slots) {
    if (slot.lastUsed < oldest.lastUsed) oldest = slot;
  }
  log.info(`BrowserPool: evicting slot for user ${oldest.userId}`);
  try {
    await oldest.context.close();
  } catch (_) {}
  const idx = slots.indexOf(oldest);
  if (idx >= 0) slots.splice(idx, 1);
}

export async function acquireBrowser(userId: string): Promise<BrowserContext> {
  // Check if user already has a slot
  const existing = slots.find((s) => s.userId === userId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.context;
  }

  // Evict if at capacity
  if (slots.length >= MAX_SLOTS) {
    await evictLRU();
  }

  log.info(`BrowserPool: launching context for user ${userId}`);
  const context = await launchContext(userId);
  slots.push({ context, userId, lastUsed: Date.now(), dataDir: path.join(BROWSER_BASE, userId) });
  return context;
}

export async function getPageForUser(userId: string, url?: string): Promise<Page> {
  const ctx = await acquireBrowser(userId);
  const pages = ctx.pages();
  let page = pages.length > 0 ? pages[0] : await ctx.newPage();

  if (url && page.url() !== url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  return page;
}

export async function closeAllBrowsers(): Promise<void> {
  for (const slot of slots) {
    try {
      await slot.context.close();
    } catch (_) {}
  }
  slots.length = 0;
  log.info('BrowserPool: all contexts closed');
}

// Legacy compatibility: single-user mode uses a default user ID
const LEGACY_USER = '__legacy__';

export async function getPage(url?: string): Promise<Page> {
  return getPageForUser(LEGACY_USER, url);
}

export async function closeBrowser(): Promise<void> {
  await closeAllBrowsers();
}
