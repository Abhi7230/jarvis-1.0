import Stripe from 'stripe';
import { updateUser, getUserById } from './db/schema';
import { log } from './logger';
import { PlanType } from './plans';

let stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    stripe = new Stripe(key);
  }
  return stripe;
}

export async function createCheckoutSession(
  userId: string,
  plan: 'pro' | 'premium'
): Promise<string> {
  const s = getStripe();
  const priceId =
    plan === 'pro'
      ? process.env.STRIPE_PRO_PRICE_ID
      : process.env.STRIPE_PREMIUM_PRICE_ID;

  if (!priceId) throw new Error(`Stripe price ID not configured for ${plan} plan`);

  const user = getUserById(userId);
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/payment/cancel`,
    metadata: { userId },
  };

  // Reuse existing Stripe customer if available
  if (user?.stripe_customer_id) {
    sessionParams.customer = user.stripe_customer_id;
  } else if (user?.email) {
    sessionParams.customer_email = user.email;
  }

  const session = await s.checkout.sessions.create(sessionParams);
  log.info(`Stripe: checkout session created for user ${userId}, plan ${plan}`);
  return session.url || '';
}

export async function handleWebhook(
  body: Buffer,
  signature: string
): Promise<void> {
  const s = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');

  const event = s.webhooks.constructEvent(body, signature, webhookSecret);
  log.info(`Stripe webhook: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      if (!userId) break;

      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;

      const customerId =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id;

      // Determine plan from price
      let plan: PlanType = 'pro';
      if (subscriptionId) {
        try {
          const sub = await s.subscriptions.retrieve(subscriptionId as string);
          const priceId = sub.items.data[0]?.price?.id;
          if (priceId === process.env.STRIPE_PREMIUM_PRICE_ID) {
            plan = 'premium';
          }
        } catch (_) {}
      }

      updateUser(userId, {
        plan,
        stripe_customer_id: customerId || null,
        stripe_subscription_id: subscriptionId || null,
        subscription_status: 'active',
      });
      log.info(`Stripe: user ${userId} upgraded to ${plan}`);
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

      // Find user by customer ID
      const user = findUserByStripeCustomer(customerId || '');
      if (!user) break;

      const status = sub.status === 'active' ? 'active' : sub.status;
      updateUser(user.id, { subscription_status: status });
      log.info(`Stripe: subscription updated for user ${user.id}, status: ${status}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

      const user = findUserByStripeCustomer(customerId || '');
      if (!user) break;

      updateUser(user.id, {
        plan: 'free',
        subscription_status: 'canceled',
        stripe_subscription_id: null,
      });
      log.info(`Stripe: user ${user.id} downgraded to free (subscription canceled)`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id;

      const user = findUserByStripeCustomer(customerId || '');
      if (!user) break;

      updateUser(user.id, { subscription_status: 'past_due' });
      log.info(`Stripe: payment failed for user ${user.id}`);
      break;
    }
  }
}

function findUserByStripeCustomer(customerId: string): any {
  const { getDb } = require('./db/schema');
  return getDb()
    .prepare('SELECT * FROM users WHERE stripe_customer_id = ?')
    .get(customerId);
}
