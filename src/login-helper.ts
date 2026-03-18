import { chromium } from 'playwright';
import path from 'path';

const BROWSER_DATA = path.join(process.cwd(), '.browser_data');

async function main() {
  console.log('Opening browser... Log into LinkedIn manually.');
  console.log('Once logged in, close the browser window and cookies will be saved.\n');

  const context = await chromium.launchPersistentContext(BROWSER_DATA, {
    headless: false,
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

  // Stealth
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

  console.log('Browser opened at LinkedIn login page.');
  console.log('→ Log in with your credentials');
  console.log('→ Complete any 2FA verification');
  console.log('→ Once you see the LinkedIn feed, close the browser window\n');

  // Wait for the browser to be closed by the user
  await new Promise<void>((resolve) => {
    (context as any).on('close', resolve);
  });

  console.log('\n✅ Cookies saved! Jarvis will now use your LinkedIn session.');
  console.log('Restart Jarvis with: npm run dev');
}

main().catch(console.error);
