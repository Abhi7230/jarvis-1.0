import 'dotenv/config';

import { initDb } from './db/schema';
import { startWhatsApp } from './whatsapp';
import { runAgent } from './agent';
import { startScheduler, startMultiUserScheduler, stopScheduler } from './scheduler';
import { closeAllBrowsers } from './browser-pool';
import { startTelegramBot, stopTelegramBot } from './telegram';
import { startHttpServer } from './http';
import { buildUserContext } from './context';
import { log } from './logger';

let ownerJid: string | null = null;
let schedulerStarted = false;

async function main() {
  log.info('Jarvis starting up...');

  // 1. Initialize database
  initDb();

  // 2. Start Telegram bot (primary multi-user interface)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    startTelegramBot();
    startMultiUserScheduler();
    log.info('Telegram bot + multi-user scheduler started');
  }

  // 3. Start HTTP server (health check + Stripe webhooks)
  const port = Number(process.env.PORT) || 3000;
  startHttpServer(port);

  // 4. Optional: WhatsApp for personal/self-hosted use
  if (process.env.WHATSAPP_ENABLED !== 'false') {
    const wa = await startWhatsApp(async (jid: string, text: string) => {
      if (!ownerJid) {
        ownerJid = jid;
        log.info(`Owner JID set to: ${jid}`);
      }

      if (!schedulerStarted && ownerJid) {
        startScheduler(wa.sendMessage, ownerJid);
        schedulerStarted = true;
      }

      // Build a legacy user context for WhatsApp self-hosted mode
      const ctx = buildUserContext({
        id: '__legacy__',
        telegram_id: null,
        telegram_username: null,
        email: null,
        name: 'Owner',
        plan: 'premium' as any, // Self-hosted gets all features
        stripe_customer_id: null,
        stripe_subscription_id: null,
        subscription_status: 'active',
        linkedin_credentials: null,
        gmail_token: null,
        overleaf_url: process.env.OVERLEAF_PROJECT_URL || null,
        daily_searches_used: 0,
        daily_messages_used: 0,
        daily_reset_at: null,
        created_at: '',
        updated_at: '',
      });

      // For legacy mode, inject env credentials
      if (process.env.LINKEDIN_EMAIL && process.env.LINKEDIN_PASSWORD) {
        ctx.linkedinCredentials = {
          email: process.env.LINKEDIN_EMAIL,
          password: process.env.LINKEDIN_PASSWORD,
        };
      }

      const response = await runAgent(text, ctx);
      return response;
    });

    log.info('Jarvis is running. Scan the QR code with WhatsApp to connect.');
  } else {
    log.info('Jarvis is running in Telegram-only mode.');
  }
}

// ── Graceful shutdown ──
async function shutdown(signal: string) {
  log.info(`Received ${signal}. Shutting down gracefully...`);
  stopScheduler();
  stopTelegramBot();
  await closeAllBrowsers();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Never crash ──
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason: any) => {
  log.error('Unhandled rejection:', reason?.message || reason);
});

main().catch((err) => {
  log.error('Fatal startup error:', err.message);
  process.exit(1);
});
