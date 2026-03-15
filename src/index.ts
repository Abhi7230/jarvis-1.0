import 'dotenv/config';

import { initDb } from './db/schema';
import { startWhatsApp } from './whatsapp';
import { runAgent } from './agent';
import { startScheduler } from './scheduler';
import { closeBrowser } from './controller';
import { log } from './logger';

let ownerJid: string | null = null;
let schedulerStarted = false;

async function main() {
  log.info('Jarvis starting up...');

  // 1. Initialize database
  initDb();

  // 2. Start WhatsApp and get sendMessage handle
  const wa = await startWhatsApp(async (jid: string, text: string) => {
    // First message sets the owner JID and starts the scheduler
    if (!ownerJid) {
      ownerJid = jid;
      log.info(`Owner JID set to: ${jid}`);
    }

    if (!schedulerStarted && ownerJid) {
      startScheduler(wa.sendMessage, ownerJid);
      schedulerStarted = true;
    }

    // Run the agent
    const response = await runAgent(text, jid);
    return response;
  });

  log.info('Jarvis is running. Scan the QR code with WhatsApp to connect.');
}

// ── Graceful shutdown ──
async function shutdown(signal: string) {
  log.info(`Received ${signal}. Shutting down gracefully...`);
  await closeBrowser();
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
