import { getPendingFollowups, getStats, getActiveSubscribedUsers } from './db/schema';
import { sendTelegramMessage } from './telegram';
import { log } from './logger';

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let intervalHandle: ReturnType<typeof setInterval> | null = null;

// Legacy single-user scheduler (for WhatsApp self-hosted mode)
export function startScheduler(
  sendMessage: (jid: string, text: string) => Promise<void>,
  ownerJid: string
) {
  if (intervalHandle) {
    log.warn('Scheduler: already running, skipping duplicate start');
    return;
  }

  log.info(`Scheduler: started (every 30 min) for owner ${ownerJid}`);

  intervalHandle = setInterval(async () => {
    try {
      const now = new Date();
      const hour = now.getHours();

      const followups = getPendingFollowups('__legacy__', 3);

      if (followups.length > 0) {
        const lines = followups.map(
          (r: any) =>
            `• *${r.name || 'Unknown'}*${r.company ? ` at ${r.company}` : ''} — contacted ${r.contacted_at}`
        );

        await sendMessage(
          ownerJid,
          `🔔 *Follow-up Reminder*\n${followups.length} recruiter(s) haven't replied in 3+ days:\n\n${lines.join('\n')}\n\nWant me to draft follow-up messages?`
        );
      }

      // Daily summary at 9pm
      if (hour === 21) {
        const stats = getStats('__legacy__');
        const followupList = getPendingFollowups('__legacy__', 3);

        let summary = `📊 *Daily Summary*\n\n`;
        summary += `Recruiters found: *${stats.total_recruiters}*\n`;
        summary += `Contacted: *${stats.contacted}*\n`;
        summary += `Replied: *${stats.replied}*\n`;
        summary += `Contacted today: *${stats.contacted_today}*/15\n`;
        summary += `Jobs tracked: *${stats.total_jobs}*\n`;

        if (followupList.length > 0) {
          summary += `\n⏳ *Pending follow-ups:* ${followupList.length}\n`;
          for (const r of followupList.slice(0, 5)) {
            summary += `• ${r.name || 'Unknown'}${r.company ? ` at ${r.company}` : ''}\n`;
          }
          if (followupList.length > 5) {
            summary += `...and ${followupList.length - 5} more\n`;
          }
        }

        await sendMessage(ownerJid, summary);
        log.info('Scheduler: sent daily summary');
      }
    } catch (e: any) {
      log.error('Scheduler error:', e.message);
    }
  }, INTERVAL_MS);
}

// Multi-user scheduler for Telegram users with paid plans
export function startMultiUserScheduler() {
  if (intervalHandle) {
    log.warn('Scheduler: already running');
    return;
  }

  log.info('Multi-user scheduler started (every 30 min)');

  intervalHandle = setInterval(async () => {
    try {
      const users = getActiveSubscribedUsers();
      const hour = new Date().getHours();

      for (const user of users) {
        if (!user.telegram_id) continue;

        // Follow-up check
        const followups = getPendingFollowups(user.id, 3);
        if (followups.length > 0) {
          const lines = followups.map(
            (r: any) =>
              `• *${r.name || 'Unknown'}*${r.company ? ` at ${r.company}` : ''} — contacted ${r.contacted_at}`
          );
          await sendTelegramMessage(
            user.telegram_id,
            `🔔 *Follow-up Reminder*\n${followups.length} recruiter(s) haven't replied in 3+ days:\n\n${lines.join('\n')}`
          );
        }

        // Daily summary at 9pm
        if (hour === 21) {
          const stats = getStats(user.id);
          let summary = `📊 *Daily Summary*\n\n`;
          summary += `Recruiters found: *${stats.total_recruiters}*\n`;
          summary += `Contacted: *${stats.contacted}*\n`;
          summary += `Replied: *${stats.replied}*\n`;
          summary += `Jobs tracked: *${stats.total_jobs}*\n`;
          await sendTelegramMessage(user.telegram_id, summary);
        }
      }
    } catch (e: any) {
      log.error('Multi-user scheduler error:', e.message);
    }
  }, INTERVAL_MS);
}

export function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Scheduler: stopped');
  }
}
