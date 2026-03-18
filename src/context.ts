import { PlanType, getPlanLimits, PlanLimits } from './plans';

export interface UserContext {
  userId: string;
  plan: PlanType;
  telegramId?: string;
  linkedinCredentials?: { email: string; password: string };
  gmailToken?: any;
  overleafUrl?: string;
  limits: PlanLimits;
}

export interface UserRow {
  id: string;
  telegram_id: string | null;
  telegram_username: string | null;
  email: string | null;
  name: string | null;
  plan: PlanType;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string;
  linkedin_credentials: string | null;
  gmail_token: string | null;
  overleaf_url: string | null;
  daily_searches_used: number;
  daily_messages_used: number;
  daily_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

export function buildUserContext(user: UserRow, decryptFn?: (s: string) => string): UserContext {
  let linkedinCredentials: { email: string; password: string } | undefined;
  let gmailToken: any;

  if (user.linkedin_credentials && decryptFn) {
    try {
      linkedinCredentials = JSON.parse(decryptFn(user.linkedin_credentials));
    } catch (_) {}
  }

  if (user.gmail_token && decryptFn) {
    try {
      gmailToken = JSON.parse(decryptFn(user.gmail_token));
    } catch (_) {}
  }

  return {
    userId: user.id,
    plan: user.plan || 'free',
    telegramId: user.telegram_id || undefined,
    linkedinCredentials,
    gmailToken,
    overleafUrl: user.overleaf_url || undefined,
    limits: getPlanLimits(user.plan || 'free'),
  };
}
