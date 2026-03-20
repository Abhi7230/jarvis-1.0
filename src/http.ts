import express from 'express';
import helmet from 'helmet';
import { handleWebhook } from './stripe';
import { log } from './logger';

let keepAliveHandle: ReturnType<typeof setInterval> | null = null;

export function startHttpServer(port: number = 3000) {
  const app = express();

  app.use(helmet());

  // Stripe webhook needs raw body
  app.post(
    '/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      try {
        const signature = req.headers['stripe-signature'] as string;
        await handleWebhook(req.body, signature);
        res.json({ received: true });
      } catch (e: any) {
        log.error('Stripe webhook error:', e.message);
        res.status(400).json({ error: e.message });
      }
    }
  );

  // Parse JSON for other routes
  app.use(express.json());

  // Root route — HuggingFace Spaces embeds this in an iframe
  app.get('/', (_req, res) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    res.send(`
      <html>
      <head><title>Jarvis - AI Job Search Agent</title></head>
      <body style="font-family:system-ui,sans-serif;text-align:center;padding:60px;background:#0f172a;color:#e2e8f0">
        <h1 style="font-size:2.5rem">🤖 Jarvis</h1>
        <p style="font-size:1.2rem;color:#94a3b8">Autonomous AI-Powered Job Search Agent</p>
        <div style="margin:40px auto;max-width:500px;background:#1e293b;border-radius:12px;padding:30px">
          <p style="color:#22c55e;font-weight:bold">● Online</p>
          <p>Uptime: ${hours}h ${minutes}m</p>
          <hr style="border-color:#334155;margin:20px 0"/>
          <p style="color:#94a3b8;font-size:0.9rem">
            Interact with Jarvis via <strong>Telegram</strong>.<br/>
            Search for <strong>@your_jarvis_bot</strong> on Telegram to get started.
          </p>
        </div>
        <p style="color:#475569;font-size:0.8rem;margin-top:40px">
          Powered by Claude, Groq &amp; Gemini | Built with Node.js &amp; Playwright
        </p>
      </body>
      </html>
    `);
  });

  // Payment success/cancel pages
  app.get('/payment/success', (_req, res) => {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>Payment Successful!</h1>
        <p>Your Jarvis subscription is now active.</p>
        <p>Go back to Telegram and start using your upgraded features.</p>
      </body></html>
    `);
  });

  app.get('/payment/cancel', (_req, res) => {
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>Payment Cancelled</h1>
        <p>No charges were made. You can upgrade anytime from Telegram.</p>
      </body></html>
    `);
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.listen(port, () => {
    log.info(`HTTP server listening on port ${port}`);

    // Self-ping every 5 minutes to prevent HuggingFace Spaces from sleeping
    startKeepAlive(port);
  });

  return app;
}

function startKeepAlive(port: number) {
  const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes

  keepAliveHandle = setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) {
        log.info('Keep-alive ping: OK');
      }
    } catch {
      log.warn('Keep-alive ping failed');
    }
  }, KEEP_ALIVE_INTERVAL);

  log.info('Keep-alive started (pinging every 5 min)');
}

export function stopKeepAlive() {
  if (keepAliveHandle) {
    clearInterval(keepAliveHandle);
    keepAliveHandle = null;
  }
}
