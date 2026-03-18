import express from 'express';
import helmet from 'helmet';
import { handleWebhook } from './stripe';
import { log } from './logger';

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
  });

  return app;
}
