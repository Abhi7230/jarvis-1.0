import { getSharedPage, getPageForUser } from '../browser-pool';
import { log } from '../logger';

// Track which page the user last browsed (per userId)
const lastBrowsedIsLinkedin: Map<string, boolean> = new Map();

export function setLastBrowseContext(userId: string, isLinkedin: boolean) {
  lastBrowsedIsLinkedin.set(userId, isLinkedin);
}

async function getActivePage(userId: string): Promise<any> {
  if (lastBrowsedIsLinkedin.get(userId)) {
    return getPageForUser(userId);
  }
  return getSharedPage();
}

const EXTRACT_SCRIPT = `(function() {
  var main = document.querySelector('main')
    || document.querySelector('[role="main"]')
    || document.querySelector('.scaffold-layout__main')
    || document.body;

  var text = main.innerText || '';
  var lines = text.split('\\n');
  var cleaned = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.length < 3) continue;
    cleaned.push(line);
  }
  return cleaned.join('\\n').slice(0, 1800);
})()`;

export async function webClick(text: string, userId: string): Promise<string> {
  try {
    const page = await getActivePage(userId);
    log.info(`web_click: clicking "${text}"`);

    // Try multiple strategies to find the element
    const selectors = [
      `button:has-text("${text}")`,
      `a:has-text("${text}")`,
      `[role="button"]:has-text("${text}")`,
      `input[value="${text}"]`,
    ];

    let clicked = false;
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 })) {
          await el.click();
          clicked = true;
          log.info(`web_click: clicked with selector: ${sel}`);
          break;
        }
      } catch (_) {}
    }

    // Fallback: try getByText
    if (!clicked) {
      try {
        await page.getByText(text, { exact: false }).first().click();
        clicked = true;
        log.info('web_click: clicked via getByText');
      } catch (_) {}
    }

    if (!clicked) {
      return `Could not find clickable element with text "${text}" on the current page.`;
    }

    await page.waitForTimeout(2000);

    // Return the updated page content
    const title = await page.title();
    const content: string = await page.evaluate(EXTRACT_SCRIPT) as string;
    const header = title ? `**${title}**\n\n` : '';
    return `Clicked "${text}". Page now shows:\n\n${header}${content}`;
  } catch (e: any) {
    log.error('web_click error:', e.message);
    return `Error clicking: ${e.message}`;
  }
}

export async function webType(field: string, value: string, userId: string): Promise<string> {
  try {
    const page = await getActivePage(userId);
    log.info(`web_type: typing into "${field}"`);

    let typed = false;

    // Try by label
    try {
      const input = page.getByLabel(field, { exact: false }).first();
      if (await input.isVisible({ timeout: 2000 })) {
        await input.fill(value);
        typed = true;
        log.info('web_type: filled via getByLabel');
      }
    } catch (_) {}

    // Try by placeholder
    if (!typed) {
      try {
        const input = page.getByPlaceholder(field, { exact: false }).first();
        if (await input.isVisible({ timeout: 2000 })) {
          await input.fill(value);
          typed = true;
          log.info('web_type: filled via getByPlaceholder');
        }
      } catch (_) {}
    }

    // Try by aria-label or name attribute
    if (!typed) {
      const selectors = [
        `input[aria-label*="${field}" i]`,
        `textarea[aria-label*="${field}" i]`,
        `input[name*="${field}" i]`,
        `textarea[name*="${field}" i]`,
        `input[placeholder*="${field}" i]`,
        `textarea[placeholder*="${field}" i]`,
      ];

      for (const sel of selectors) {
        try {
          const input = page.locator(sel).first();
          if (await input.isVisible({ timeout: 1000 })) {
            await input.fill(value);
            typed = true;
            log.info(`web_type: filled via selector: ${sel}`);
            break;
          }
        } catch (_) {}
      }
    }

    if (!typed) {
      return `Could not find input field "${field}" on the current page.`;
    }

    return `Typed "${value}" into "${field}" field.`;
  } catch (e: any) {
    log.error('web_type error:', e.message);
    return `Error typing: ${e.message}`;
  }
}
