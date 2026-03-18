import { Page } from 'playwright';
import { getPageForUser } from '../browser-pool';
import { log } from '../logger';

const _pendingVerificationPages: Map<string, Page> = new Map();

export async function linkedinLogin(email: string, password: string, userId: string = '__legacy__'): Promise<string> {
  const page = await getPageForUser(userId, 'https://www.linkedin.com/login');
  await page.waitForTimeout(2000);

  if (page.url().includes('/feed') || page.url().includes('/mynetwork')) {
    log.info('LinkedIn: already logged in');
    return 'Already logged in to LinkedIn.';
  }

  try {
    await page.fill('input#username', email);
    await page.waitForTimeout(500);
    await page.fill('input#password', password);
    await page.waitForTimeout(500);

    const signInBtn = page.locator('button[type="submit"], button[data-litms-control-urn*="login-submit"]');
    await signInBtn.click();
    await page.waitForTimeout(5000);
  } catch (e: any) {
    log.error('LinkedIn login form error:', e.message);
    return `Login form error: ${e.message}`;
  }

  const currentUrl = page.url();
  if (
    currentUrl.includes('checkpoint') ||
    currentUrl.includes('challenge') ||
    currentUrl.includes('verification') ||
    currentUrl.includes('pin')
  ) {
    _pendingVerificationPages.set(userId, page);
    log.info('LinkedIn: verification challenge detected');
    return '🔐 LinkedIn requires verification. Check your email/phone for a code and send me: verify <code>';
  }

  if (page.url().includes('/feed') || page.url().includes('/mynetwork')) {
    log.info('LinkedIn: login successful');
    return 'Successfully logged in to LinkedIn!';
  }

  try {
    const errorEl = await page.$('#error-for-password, .alert-content, [role="alert"]');
    if (errorEl) {
      const errorText = await errorEl.textContent();
      return `Login failed: ${errorText?.trim() || 'Unknown error'}`;
    }
  } catch (_) {}

  return 'Login submitted. Check if further action is needed.';
}

export async function linkedinVerify(code: string, userId: string = '__legacy__'): Promise<string> {
  const page = _pendingVerificationPages.get(userId);
  if (!page) {
    return 'No pending verification. Try logging in first.';
  }

  try {
    const selectors = [
      'input[name="pin"]',
      'input[autocomplete="one-time-code"]',
      'input[type="number"]',
      'input[inputmode="numeric"]',
      'input#input__email_verification_pin',
      'input#input__phone_verification_pin',
      'input.input_verification_pin',
    ];

    let filled = false;
    for (const sel of selectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(code);
          filled = true;
          log.info(`LinkedIn: filled verification code using selector: ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!filled) {
      const inputs = page.locator('input[type="text"], input:not([type])');
      const count = await inputs.count();
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          await input.fill(code);
          filled = true;
          log.info('LinkedIn: filled verification code using fallback input');
          break;
        }
      }
    }

    if (!filled) {
      return 'Could not find verification input field. Try logging in again.';
    }

    await page.waitForTimeout(500);

    const submitSelectors = [
      'button[type="submit"]',
      'button#two-step-submit-button',
      'button.btn__primary--large',
      'form button',
    ];

    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          break;
        }
      } catch (_) {}
    }

    await page.waitForTimeout(5000);
    _pendingVerificationPages.delete(userId);

    if (page.url().includes('/feed') || page.url().includes('/mynetwork')) {
      log.info('LinkedIn: verification successful');
      return 'Verification successful! Logged in to LinkedIn.';
    }

    return 'Verification code submitted. Check if further action is needed.';
  } catch (e: any) {
    _pendingVerificationPages.delete(userId);
    log.error('LinkedIn verification error:', e.message);
    return `Verification error: ${e.message}`;
  }
}

export async function linkedinStatus(userId: string = '__legacy__'): Promise<string> {
  try {
    const page = await getPageForUser(userId, 'https://www.linkedin.com/feed');
    await page.waitForTimeout(3000);
    const url = page.url();

    if (url.includes('/feed') || url.includes('/mynetwork')) {
      try {
        const nameEl = await page.$('.feed-identity-module__actor-meta a, .profile-rail-card__actor-link');
        if (nameEl) {
          const name = await nameEl.textContent();
          return `✅ Logged in as *${name?.trim()}*`;
        }
      } catch (_) {}
      return '✅ Logged in to LinkedIn';
    }

    if (url.includes('/login') || url.includes('/authwall')) {
      return '❌ Not logged in to LinkedIn. Send: login to LinkedIn';
    }

    return `LinkedIn status unclear. Current page: ${url}`;
  } catch (e: any) {
    return `Error checking LinkedIn status: ${e.message}`;
  }
}
