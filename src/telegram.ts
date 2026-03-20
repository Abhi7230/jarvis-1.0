import { Bot, Context, InlineKeyboard } from 'grammy';
import crypto from 'crypto';
import { createUser, getUserByTelegramId, updateUser } from './db/schema';
import { buildUserContext, UserContext } from './context';
import { decrypt, encrypt } from './crypto';
import { runAgent } from './agent';
import { createCheckoutSession } from './stripe';
import { PLAN_PRICES } from './plans';
import { log } from './logger';

let bot: Bot | null = null;

// Conversation states for multi-step flows
const conversationState: Map<string, { step: string; data: Record<string, any> }> = new Map();

function getOrCreateUser(telegramId: string, username?: string, firstName?: string) {
  let user = getUserByTelegramId(telegramId);
  if (!user) {
    const id = crypto.randomUUID();
    user = createUser({
      id,
      telegram_id: telegramId,
      telegram_username: username,
      name: firstName,
    });
    log.info(`Telegram: new user created — ${firstName} (@${username}), id=${id}`);
  }
  return user;
}

function getUserContext(user: any): UserContext {
  return buildUserContext(user, (s: string) => {
    try { return decrypt(s); } catch { return s; }
  });
}

// Safe reply — tries Markdown first, falls back to plain text
async function safeReply(ctx: Context, text: string, extra?: any) {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown', ...extra });
  } catch {
    try {
      await ctx.reply(text, extra);
    } catch (e: any) {
      log.error('Telegram: failed to send reply:', e.message);
    }
  }
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn('TELEGRAM_BOT_TOKEN not set, skipping Telegram bot');
    return;
  }

  bot = new Bot(token);

  // Error handler — log but don't crash
  bot.catch((err) => {
    log.error('Telegram bot error:', err.message || err);
  });

  // /start — register user (also handles deep links like /start premium)
  bot.command('start', async (ctx) => {
    const user = getOrCreateUser(
      String(ctx.from?.id),
      ctx.from?.username,
      ctx.from?.first_name
    );

    // Check for deep link payload (e.g. t.me/bot?start=premium)
    const payload = ctx.match;
    if (payload === 'premium') {
      await safeReply(ctx,
        `Hey ${user.name || 'there'}! You want Premium? Great choice!\n\n` +
        `Premium Plan — Rs.499/month\n` +
        `- 50 LinkedIn searches/day\n` +
        `- 50 LinkedIn messages/day\n` +
        `- Auto follow-up reminders\n` +
        `- Gmail integration\n` +
        `- Resume editing\n\n` +
        `To activate Premium:\n` +
        `1. Pay Rs.499 via UPI: abhir0609-3@oksbi\n` +
        `2. Send the payment screenshot here\n` +
        `3. I'll activate Premium within minutes!\n\n` +
        `Or type /start to explore the free plan first.`
      );
      return;
    }

    await safeReply(ctx,
      `Hey ${user.name || 'there'}! I'm Jarvis — your AI job search assistant.\n\n` +
      `I can help you:\n` +
      `- Search for recruiters on LinkedIn\n` +
      `- Send personalized messages\n` +
      `- Track your outreach & follow-ups\n` +
      `- Manage job applications\n\n` +
      `Get started:\n` +
      `/login\\_linkedin — Connect LinkedIn\n` +
      `/plan — View your current plan\n` +
      `/help — See all commands`
    );
  });

  // /help
  bot.command('help', async (ctx) => {
    await safeReply(ctx,
      `Jarvis Commands\n\n` +
      `/login\\_linkedin — Connect your LinkedIn account\n` +
      `/plan — View your current plan & usage\n` +
      `/upgrade — Upgrade to Pro or Premium\n` +
      `/stats — Quick job search stats\n` +
      `/help — Show this message\n\n` +
      `Or just type naturally:\n` +
      `- "Search for recruiters at Google"\n` +
      `- "Message John about the SWE role"\n` +
      `- "Show my follow-ups"\n` +
      `- "Save this job: SWE at Meta"`
    );
  });

  // /login_linkedin — start credential collection
  bot.command('login_linkedin', async (ctx) => {
    conversationState.set(String(ctx.from?.id), {
      step: 'linkedin_email',
      data: {},
    });
    await safeReply(ctx,
      'Let\'s connect your LinkedIn account.\n\n' +
      'Send me your LinkedIn email address:'
    );
  });

  // /plan — show current plan
  bot.command('plan', async (ctx) => {
    const user = getOrCreateUser(String(ctx.from?.id), ctx.from?.username, ctx.from?.first_name);
    const planEmoji = user.plan === 'premium' ? '👑' : user.plan === 'pro' ? '⭐' : '🆓';
    await safeReply(ctx,
      `${planEmoji} Your Plan: ${user.plan.toUpperCase()}\n\n` +
      `Searches today: ${user.daily_searches_used}\n` +
      `Messages today: ${user.daily_messages_used}\n` +
      `Status: ${user.subscription_status}\n\n` +
      (user.plan === 'free' ? 'Use /upgrade to unlock more features!' : 'Enjoying Jarvis? Tell your friends!')
    );
  });

  // /upgrade — show pricing
  bot.command('upgrade', async (ctx) => {
    const user = getOrCreateUser(String(ctx.from?.id), ctx.from?.username, ctx.from?.first_name);

    if (user.plan !== 'free') {
      await safeReply(ctx, `You're already on the ${user.plan.toUpperCase()} plan!`);
      return;
    }

    await safeReply(ctx,
      `Upgrade Jarvis\n\n` +
      `Premium — Rs.499/month\n` +
      `- 50 LinkedIn searches/day\n` +
      `- 50 LinkedIn messages/day\n` +
      `- Auto follow-up reminders\n` +
      `- Gmail integration\n` +
      `- Resume editing (Overleaf)\n\n` +
      `To upgrade:\n` +
      `1. Pay Rs.499 via UPI: abhir0609-3@oksbi\n` +
      `2. Send payment screenshot here\n` +
      `3. Premium activates within minutes!`
    );
  });

  // /stats — quick stats
  bot.command('stats', async (ctx) => {
    const user = getOrCreateUser(String(ctx.from?.id), ctx.from?.username, ctx.from?.first_name);
    const userCtx = getUserContext(user);
    const response = await runAgent('show my stats', userCtx);
    await sendLongMessage(ctx, response);
  });

  // Main message handler
  bot.on('message:text', async (ctx) => {
    const telegramId = String(ctx.from.id);

    // Handle conversation states (credential collection)
    const state = conversationState.get(telegramId);
    if (state) {
      await handleConversationState(ctx, telegramId, state);
      return;
    }

    // Normal message → agent
    const user = getOrCreateUser(telegramId, ctx.from.username, ctx.from.first_name);
    const userCtx = getUserContext(user);

    try {
      const response = await runAgent(ctx.message.text, userCtx);
      await sendLongMessage(ctx, response);
    } catch (e: any) {
      log.error('Telegram agent error:', e.message);
      await safeReply(ctx, 'Something went wrong. Please try again.');
    }
  });

  bot.start();
  log.info('Telegram bot started');
}

async function handleConversationState(
  ctx: Context,
  telegramId: string,
  state: { step: string; data: Record<string, any> }
) {
  const text = (ctx.message as any)?.text?.trim();
  if (!text) return;

  if (text.toLowerCase() === '/cancel') {
    conversationState.delete(telegramId);
    await safeReply(ctx, 'Cancelled.');
    return;
  }

  switch (state.step) {
    case 'linkedin_email': {
      state.data.email = text;
      state.step = 'linkedin_password';
      conversationState.set(telegramId, state);
      // Delete the message containing the email for privacy
      try { await ctx.deleteMessage(); } catch (_) {}
      await safeReply(ctx,
        'Got it. Now send your LinkedIn password:\n\n' +
        '(I will encrypt it and delete this message immediately)'
      );
      break;
    }

    case 'linkedin_password': {
      const email = state.data.email;
      const password = text;

      // Delete the password message immediately
      try { await ctx.deleteMessage(); } catch (_) {}
      conversationState.delete(telegramId);

      // Encrypt and store
      const user = getUserByTelegramId(telegramId);
      if (user) {
        const encrypted = encrypt(JSON.stringify({ email, password }));
        updateUser(user.id, { linkedin_credentials: encrypted });
        await safeReply(ctx,
          'LinkedIn credentials saved securely!\n\n' +
          'Now try: "Search for recruiters at Google"'
        );
        log.info(`Telegram: LinkedIn credentials saved for user ${user.id}`);
      }
      break;
    }
  }
}

async function sendLongMessage(ctx: Context, text: string) {
  const maxLen = 4000;
  if (text.length <= maxLen) {
    await safeReply(ctx, text);
    return;
  }

  let remaining = text;
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, maxLen);
    remaining = remaining.slice(maxLen);
    await safeReply(ctx, chunk);
    if (remaining.length > 0) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export function stopTelegramBot() {
  if (bot) {
    bot.stop();
    bot = null;
    log.info('Telegram bot stopped');
  }
}

// Export for sending messages from scheduler
export async function sendTelegramMessage(telegramId: string, text: string) {
  if (!bot) return;
  try {
    await bot.api.sendMessage(telegramId, text).catch((e: any) => {
      log.error(`Telegram: sendMessage fallback error:`, e.message);
    });
  } catch (e: any) {
    log.error(`Telegram: failed to send to ${telegramId}:`, e.message);
  }
}
