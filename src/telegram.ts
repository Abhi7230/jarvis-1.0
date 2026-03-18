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

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn('TELEGRAM_BOT_TOKEN not set, skipping Telegram bot');
    return;
  }

  bot = new Bot(token);

  // /start — register user
  bot.command('start', async (ctx) => {
    const user = getOrCreateUser(
      String(ctx.from?.id),
      ctx.from?.username,
      ctx.from?.first_name
    );
    await ctx.reply(
      `Hey ${user.name || 'there'}! I'm *Jarvis* — your AI job search assistant.\n\n` +
      `I can help you:\n` +
      `• Search for recruiters on LinkedIn\n` +
      `• Send personalized messages\n` +
      `• Track your outreach & follow-ups\n` +
      `• Manage job applications\n\n` +
      `Get started by connecting your LinkedIn:\n` +
      `/login_linkedin — Connect LinkedIn\n` +
      `/plan — View your current plan\n` +
      `/help — See all commands`,
      { parse_mode: 'Markdown' }
    );
  });

  // /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      `*Jarvis Commands*\n\n` +
      `/login_linkedin — Connect your LinkedIn account\n` +
      `/plan — View your current plan & usage\n` +
      `/upgrade — Upgrade to Pro or Premium\n` +
      `/stats — Quick job search stats\n` +
      `/help — Show this message\n\n` +
      `Or just type naturally:\n` +
      `• "Search for recruiters at Google"\n` +
      `• "Message John about the SWE role"\n` +
      `• "Show my follow-ups"\n` +
      `• "Save this job: SWE at Meta"`,
      { parse_mode: 'Markdown' }
    );
  });

  // /login_linkedin — start credential collection
  bot.command('login_linkedin', async (ctx) => {
    conversationState.set(String(ctx.from?.id), {
      step: 'linkedin_email',
      data: {},
    });
    await ctx.reply(
      '🔐 Let\'s connect your LinkedIn account.\n\n' +
      'Send me your *LinkedIn email address*:',
      { parse_mode: 'Markdown' }
    );
  });

  // /plan — show current plan
  bot.command('plan', async (ctx) => {
    const user = getOrCreateUser(String(ctx.from?.id), ctx.from?.username, ctx.from?.first_name);
    const planEmoji = user.plan === 'premium' ? '👑' : user.plan === 'pro' ? '⭐' : '🆓';
    await ctx.reply(
      `${planEmoji} *Your Plan: ${user.plan.toUpperCase()}*\n\n` +
      `Searches today: ${user.daily_searches_used}\n` +
      `Messages today: ${user.daily_messages_used}\n` +
      `Status: ${user.subscription_status}\n\n` +
      (user.plan === 'free' ? 'Use /upgrade to unlock more features!' : 'Enjoying Jarvis? Tell your friends!'),
      { parse_mode: 'Markdown' }
    );
  });

  // /upgrade — show pricing + Stripe links
  bot.command('upgrade', async (ctx) => {
    const user = getOrCreateUser(String(ctx.from?.id), ctx.from?.username, ctx.from?.first_name);

    if (user.plan !== 'free') {
      await ctx.reply(`You're already on the *${user.plan.toUpperCase()}* plan!`, { parse_mode: 'Markdown' });
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(`⭐ ${PLAN_PRICES.pro.label}`, 'upgrade_pro')
      .row()
      .text(`👑 ${PLAN_PRICES.premium.label}`, 'upgrade_premium');

    await ctx.reply(
      `*Upgrade Jarvis*\n\n` +
      `⭐ *Pro ($19/mo)*\n` +
      `• 15 LinkedIn searches/day\n` +
      `• Send messages to recruiters\n` +
      `• Gmail integration\n` +
      `• Follow-up scheduler\n\n` +
      `👑 *Premium ($49/mo)*\n` +
      `• 50 LinkedIn searches/day\n` +
      `• 50 messages/day\n` +
      `• Resume editing (Overleaf)\n` +
      `• Priority browser queue\n` +
      `• Everything in Pro`,
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // Handle upgrade button clicks
  bot.callbackQuery('upgrade_pro', async (ctx) => {
    await handleUpgrade(ctx, 'pro');
  });

  bot.callbackQuery('upgrade_premium', async (ctx) => {
    await handleUpgrade(ctx, 'premium');
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
      await ctx.reply('⚠️ Something went wrong. Please try again.');
    }
  });

  bot.start();
  log.info('Telegram bot started');
}

async function handleUpgrade(ctx: Context, plan: 'pro' | 'premium') {
  try {
    const user = getOrCreateUser(
      String(ctx.from?.id),
      ctx.from?.username,
      ctx.from?.first_name
    );
    const url = await createCheckoutSession(user.id, plan);
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `💳 Click below to upgrade to *${plan.toUpperCase()}*:\n\n${url}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e: any) {
    log.error('Stripe checkout error:', e.message);
    await ctx.answerCallbackQuery({ text: 'Error creating checkout. Try again.' });
  }
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
    await ctx.reply('Cancelled.');
    return;
  }

  switch (state.step) {
    case 'linkedin_email': {
      state.data.email = text;
      state.step = 'linkedin_password';
      conversationState.set(telegramId, state);
      // Delete the message containing the email for privacy
      try { await ctx.deleteMessage(); } catch (_) {}
      await ctx.reply(
        '✅ Got it. Now send your *LinkedIn password*:\n\n' +
        '_(I will encrypt it and delete this message immediately)_',
        { parse_mode: 'Markdown' }
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
        await ctx.reply(
          '🔐 LinkedIn credentials saved securely!\n\n' +
          'Now try: "Search for recruiters at Google"'
        );
        log.info(`Telegram: LinkedIn credentials saved for user ${user.id}`);
      }
      break;
    }
  }
}

async function sendLongMessage(ctx: Context, text: string) {
  // Telegram's max message length is 4096
  const maxLen = 4000;
  if (text.length <= maxLen) {
    await ctx.reply(text, { parse_mode: 'Markdown' }).catch(() => {
      // Fallback without markdown if parsing fails
      ctx.reply(text);
    });
    return;
  }

  // Split into chunks
  let remaining = text;
  while (remaining.length > 0) {
    const chunk = remaining.slice(0, maxLen);
    remaining = remaining.slice(maxLen);
    await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => {
      ctx.reply(chunk);
    });
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
    await bot.api.sendMessage(telegramId, text, { parse_mode: 'Markdown' }).catch(() => {
      bot!.api.sendMessage(telegramId, text);
    });
  } catch (e: any) {
    log.error(`Telegram: failed to send to ${telegramId}:`, e.message);
  }
}
