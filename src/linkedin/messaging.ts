import { getPage } from '../controller';
import {
  getContactedToday,
  isRecruiterContacted,
  markRecruiterContacted,
  upsertRecruiter,
} from '../db/schema';
import { log } from '../logger';
import fs from 'fs';
import path from 'path';

const DAILY_LIMIT = 15;

export async function linkedinMessage(
  profileUrl: string,
  message: string,
  recruiterName?: string,
  company?: string
): Promise<string> {
  // Normalize URL
  if (!profileUrl.startsWith('http')) {
    profileUrl = `https://www.linkedin.com${profileUrl.startsWith('/') ? '' : '/in/'}${profileUrl}`;
  }

  // Check daily limit
  const todayCount = getContactedToday();
  if (todayCount >= DAILY_LIMIT) {
    return `⚠️ Daily message limit reached (${todayCount}/${DAILY_LIMIT}). Try again tomorrow.`;
  }

  // Check dedup
  if (isRecruiterContacted(profileUrl)) {
    return `Already contacted this recruiter: ${profileUrl}`;
  }

  try {
    log.info(`LinkedIn: navigating to profile ${profileUrl}`);
    const page = await getPage(profileUrl);
    await page.waitForTimeout(4000);

    if (page.url().includes('/login') || page.url().includes('/authwall')) {
      return 'Not logged in to LinkedIn. Please log in first.';
    }

    // ── Step 1: Open messaging window ──
    // Strategy: Extract the profile slug and navigate directly to messaging
    const slugMatch = profileUrl.match(/\/in\/([^/?]+)/);
    const profileSlug = slugMatch ? slugMatch[1] : '';

    // First try: navigate to the direct messaging URL for this person
    // We need the person's member URN. Let's try clicking the Message button on their profile first.
    // But we need to make sure the messaging overlay opens, not a share dialog.

    // Close any existing overlays/popups first
    try {
      const closeButtons = page.locator('button[aria-label="Dismiss"], button[aria-label="Close"], .artdeco-modal__dismiss');
      const count = await closeButtons.count();
      for (let i = 0; i < count; i++) {
        try {
          const btn = closeButtons.nth(i);
          if (await btn.isVisible({ timeout: 500 })) {
            await btn.click();
            await page.waitForTimeout(300);
          }
        } catch (_) {}
      }
    } catch (_) {}

    const pageTitle = await page.title();
    log.info(`LinkedIn: on page "${pageTitle}"`);

    // Try to find the messaging link directly on the page
    let messagingOpened = false;

    // Method 1: Click "Message" button that opens the messaging overlay (not share dialog)
    // Look specifically for the primary action button, not the share button
    try {
      // The primary "Message" button on a 1st-degree connection profile
      const msgBtn = page.locator('button.pvs-profile-actions__action:has-text("Message"), section.artdeco-card button:has-text("Message")').first();
      if (await msgBtn.isVisible({ timeout: 2000 })) {
        await msgBtn.evaluate((el: HTMLElement) => el.click());
        await page.waitForTimeout(2000);

        // Check if the messaging overlay opened (not a share dialog)
        const msgOverlay = page.locator('.msg-overlay-conversation-bubble, .msg-form, div[class*="msg-overlay"]').first();
        if (await msgOverlay.isVisible({ timeout: 3000 })) {
          messagingOpened = true;
          log.info('LinkedIn: messaging overlay opened via profile button');
        } else {
          // A share/post dialog might have opened — close it
          log.warn('LinkedIn: Message button opened wrong dialog, closing...');
          try {
            const dismiss = page.locator('button[aria-label="Dismiss"], button[aria-label="Close"], .artdeco-modal__dismiss').first();
            if (await dismiss.isVisible({ timeout: 1000 })) {
              await dismiss.click();
              await page.waitForTimeout(500);
            }
          } catch (_) {}
        }
      }
    } catch (_) {}

    // Method 2: Navigate to LinkedIn messaging page and start a new conversation
    if (!messagingOpened) {
      log.info('LinkedIn: trying direct messaging page approach');
      try {
        // Go to messaging and use the compose feature
        await page.goto(`https://www.linkedin.com/messaging/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);

        // Click compose/new message button
        const composeBtn = page.locator('button[aria-label*="Compose"], a[href*="messaging/compose"], button:has-text("Compose message"), .msg-conversations-container__compose-btn').first();
        if (await composeBtn.isVisible({ timeout: 3000 })) {
          await composeBtn.click();
          await page.waitForTimeout(2000);

          // Type the person's name in the "To" field
          const toField = page.locator('input[role="combobox"], input[aria-label*="Type a name"], input[placeholder*="Type a name"], .msg-compose-form input').first();
          if (await toField.isVisible({ timeout: 3000 })) {
            await toField.click();
            await toField.fill(recruiterName || profileSlug.replace(/-/g, ' '));
            await page.waitForTimeout(2000);

            // Click the first suggestion
            const suggestion = page.locator('.msg-compose-typeahead-entry, [role="option"], .basic-typeahead__selectable').first();
            if (await suggestion.isVisible({ timeout: 3000 })) {
              await suggestion.click();
              await page.waitForTimeout(1000);
              messagingOpened = true;
              log.info('LinkedIn: messaging opened via compose page');
            }
          }
        }
      } catch (e: any) {
        log.warn('LinkedIn: compose approach failed:', e.message);
      }
    }

    // Method 3: Go back to profile and try all Message button selectors
    if (!messagingOpened) {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const messageButtonSelectors = [
        'button[aria-label*="Message"][aria-label*="' + (recruiterName?.split(' ')[0] || '') + '"]',
        'a[href*="/messaging/thread/"]',
        'button.message-anywhere-button',
      ];

      for (const sel of messageButtonSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.isVisible({ timeout: 2000 })) {
            await btn.click();
            await page.waitForTimeout(3000);
            const msgForm = page.locator('.msg-form, .msg-overlay-conversation-bubble').first();
            if (await msgForm.isVisible({ timeout: 2000 })) {
              messagingOpened = true;
              log.info(`LinkedIn: messaging opened with: ${sel}`);
              break;
            }
          }
        } catch (_) {}
      }
    }

    if (!messagingOpened) {
      const screenshotPath = path.join(process.cwd(), '.debug_screenshot.png');
      try { await page.screenshot({ path: screenshotPath }); } catch (_) {}

      const connectBtn = page.locator('button:has-text("Connect"), button[aria-label*="Connect"]').first();
      const hasConnect = await connectBtn.isVisible({ timeout: 1000 }).catch(() => false);

      if (hasConnect) {
        return `❌ Cannot message *${recruiterName || 'this person'}* — they are not a 1st-degree connection.`;
      }
      return `❌ Could not open messaging for ${profileUrl}. The profile layout may have changed.`;
    }

    // Wait for message window to fully load
    await page.waitForTimeout(4000);

    // ── Step 2: Find the message input inside the messaging overlay ONLY ──
    // IMPORTANT: Only target inputs inside the messaging panel to avoid typing in "Start a post"
    const inputSelectors = [
      // Messaging overlay specific selectors
      '.msg-form__contenteditable[contenteditable="true"]',
      '.msg-overlay-conversation-bubble div.msg-form__contenteditable',
      '.msg-overlay-conversation-bubble div[role="textbox"]',
      '.msg-overlay-conversation-bubble div[contenteditable="true"]',
      // Generic messaging form selectors
      'div.msg-form__contenteditable[contenteditable="true"]',
      'div.msg-form__msg-content-container div[contenteditable="true"]',
      'form.msg-form div[contenteditable="true"]',
      // Aria-label based (messaging specific)
      'div[aria-label="Write a message…"][contenteditable="true"]',
      'div[aria-label*="Write a message"][contenteditable="true"]',
      // Full page messaging view
      '.msg-s-message-list-content + div div[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
    ];

    let typed = false;
    for (const sel of inputSelectors) {
      try {
        const input = page.locator(sel).first();
        if (await input.isVisible({ timeout: 2000 })) {
          // SAFETY CHECK: make sure this element is inside a messaging container
          const isInMessaging = await input.evaluate((el: HTMLElement) => {
            const parent = el.closest('.msg-overlay-conversation-bubble, .msg-form, .messaging-detail, [class*="msg-"], [class*="messaging"]');
            return !!parent;
          });

          if (!isInMessaging) {
            log.warn(`LinkedIn: selector ${sel} matched but NOT inside messaging container, skipping`);
            continue;
          }

          await input.click();
          await page.waitForTimeout(500);

          // Clear any existing text
          await page.keyboard.press('Meta+A'); // Mac: Cmd+A
          await page.keyboard.press('Backspace');

          // Human-like typing
          for (const char of message) {
            await page.keyboard.type(char, { delay: 30 + Math.random() * 50 });
          }
          typed = true;
          log.info(`LinkedIn: typed message using: ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!typed) {
      // Save screenshot for debugging
      const debugPath = path.join(process.cwd(), '.debug_msg_input.png');
      try { await page.screenshot({ path: debugPath }); } catch (_) {}
      log.error('LinkedIn: could not find message input area. Screenshot saved.');
      return '❌ Message window opened but could not find the text input. The messaging UI may have changed.';
    }

    await page.waitForTimeout(1000);

    // ── Step 3: Click Send — ONLY inside messaging form ──
    const sendSelectors = [
      'button.msg-form__send-button',
      'button[type="submit"].msg-form__send-button',
      'button.msg-form__send-btn',
      'form.msg-form button[type="submit"]',
      '.msg-overlay-conversation-bubble button[aria-label="Send"]',
    ];

    let sent = false;
    for (const sel of sendSelectors) {
      try {
        const sendBtn = page.locator(sel).first();
        if (await sendBtn.isVisible({ timeout: 2000 })) {
          await sendBtn.evaluate((el: HTMLElement) => el.click());
          sent = true;
          log.info(`LinkedIn: clicked Send with: ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!sent) {
      // Save screenshot for debugging
      const debugPath = path.join(process.cwd(), '.debug_send_btn.png');
      try { await page.screenshot({ path: debugPath }); } catch (_) {}
      log.error('LinkedIn: could not find Send button. Screenshot saved.');
      return '❌ Message typed but could not find Send button inside messaging window.';
    }

    await page.waitForTimeout(2000);

    // Record in DB
    upsertRecruiter({
      name: recruiterName || '',
      profile_url: profileUrl,
      company: company,
    });
    markRecruiterContacted(profileUrl, message);

    const remaining = DAILY_LIMIT - todayCount - 1;
    log.info(`LinkedIn: ✅ message sent to ${recruiterName || profileUrl}. ${remaining} messages remaining today.`);
    return `✅ Message sent to *${recruiterName || profileUrl}*${company ? ` at *${company}*` : ''}. (${remaining} messages left today)`;
  } catch (e: any) {
    log.error('LinkedIn messaging error:', e.message);
    return `❌ Error sending message: ${e.message}`;
  }
}

export async function linkedinBulkMessage(
  profiles: { profileUrl: string; name?: string; company?: string }[],
  messageTemplate: string
): Promise<string> {
  const results: string[] = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const profile of profiles) {
    if (getContactedToday() >= DAILY_LIMIT) {
      results.push(`⚠️ Daily limit reached. Stopped after ${sent} messages.`);
      break;
    }

    if (isRecruiterContacted(profile.profileUrl)) {
      skipped++;
      continue;
    }

    let message = messageTemplate;
    if (profile.name) {
      message = message.replace(/\{name\}/g, profile.name.split(' ')[0]);
    }
    if (profile.company) {
      message = message.replace(/\{company\}/g, profile.company);
    }

    const result = await linkedinMessage(
      profile.profileUrl,
      message,
      profile.name,
      profile.company
    );

    if (result.startsWith('✅')) {
      sent++;
    } else {
      failed++;
      results.push(`❌ ${profile.name || profile.profileUrl}: ${result}`);
    }

    // Delay between messages (60-90 seconds)
    if (profiles.indexOf(profile) < profiles.length - 1) {
      const delay = 60000 + Math.random() * 30000;
      log.info(`LinkedIn: waiting ${Math.round(delay / 1000)}s before next message`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  let summary = `📊 Bulk messaging complete: *${sent}* sent, *${skipped}* skipped, *${failed}* failed.`;
  if (results.length > 0) summary += '\n' + results.join('\n');
  return summary;
}
