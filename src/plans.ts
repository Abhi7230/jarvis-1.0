export type PlanType = 'free' | 'pro' | 'premium';

export interface PlanLimits {
  linkedinSearchesPerDay: number;
  linkedinMessagesPerDay: number;
  agentRounds: number;
  allowedTools: string[] | 'all';
  schedulerEnabled: boolean;
  gmailEnabled: boolean;
  overleafEnabled: boolean;
  priorityBrowser: boolean;
}

export const PLANS: Record<PlanType, PlanLimits> = {
  free: {
    linkedinSearchesPerDay: 5,
    linkedinMessagesPerDay: 0,
    agentRounds: 5,
    allowedTools: [
      'linkedin_login',
      'linkedin_verify',
      'linkedin_search',
      'linkedin_status',
      'linkedin_get_profile',
      'linkedin_browse',
      'web_browse',
      'web_search',
      'gmail_read',
      'get_stats',
      'get_jobs',
      'save_job',
      'get_followups',
      'clear_history',
    ],
    schedulerEnabled: false,
    gmailEnabled: false,
    overleafEnabled: false,
    priorityBrowser: false,
  },
  pro: {
    linkedinSearchesPerDay: 15,
    linkedinMessagesPerDay: 15,
    agentRounds: 5,
    allowedTools: 'all',
    schedulerEnabled: true,
    gmailEnabled: true,
    overleafEnabled: false,
    priorityBrowser: false,
  },
  premium: {
    linkedinSearchesPerDay: 50,
    linkedinMessagesPerDay: 50,
    agentRounds: 10,
    allowedTools: 'all',
    schedulerEnabled: true,
    gmailEnabled: true,
    overleafEnabled: true,
    priorityBrowser: true,
  },
};

export function getPlanLimits(plan: PlanType): PlanLimits {
  return PLANS[plan] || PLANS.free;
}

export function isToolAllowed(plan: PlanType, toolName: string): boolean {
  const limits = getPlanLimits(plan);
  if (limits.allowedTools === 'all') return true;
  return limits.allowedTools.includes(toolName);
}

export const PLAN_PRICES = {
  pro: { monthly: 19, label: 'Pro — $19/mo' },
  premium: { monthly: 49, label: 'Premium — $49/mo' },
};
