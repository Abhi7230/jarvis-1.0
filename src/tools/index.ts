import { linkedinLogin, linkedinVerify, linkedinStatus } from '../linkedin/auth';
import { linkedinSearch, linkedinGetProfile } from '../linkedin/search';
import { linkedinMessage, linkedinBulkMessage } from '../linkedin/messaging';
import { linkedinBrowse } from '../linkedin/browse';
import { webBrowse } from '../web/browse';
import { webSearch } from '../web/search';
import { webClick, webType, setLastBrowseContext } from '../web/interact';
import { overleafRead, overleafReplace, overleafCompile } from '../overleaf/editor';
import { gmailSend, gmailRead, gmailBody, gmailLabel } from '../gmail/index';
import {
  getPendingFollowups,
  getStats,
  saveJob,
  getJobs,
  clearChatHistory,
} from '../db/schema';
import { log } from '../logger';
import { UserContext } from '../context';
import { isToolAllowed } from '../plans';

// ── Tool definitions for the LLM (OpenAI-compatible format) ──

export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_login',
      description: 'Log in to LinkedIn using stored credentials. No parameters needed — credentials come from your account settings.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_verify',
      description: 'Submit 2FA verification code for LinkedIn login.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The verification code' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_status',
      description: 'Check if currently logged in to LinkedIn.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_search',
      description:
        'Search LinkedIn for people matching a query. Returns names, headlines, locations, and profile URLs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "recruiter software engineer San Francisco")' },
          max_results: { type: 'number', description: 'Maximum results to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_get_profile',
      description: 'Get detailed profile information for a LinkedIn user.',
      parameters: {
        type: 'object',
        properties: {
          profile_url: { type: 'string', description: 'Full LinkedIn profile URL' },
        },
        required: ['profile_url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_message',
      description:
        'Send a personalized message to a LinkedIn connection. Checks daily limit and dedup automatically.',
      parameters: {
        type: 'object',
        properties: {
          profile_url: { type: 'string', description: 'Full LinkedIn profile URL' },
          message: { type: 'string', description: 'The message to send' },
          recruiter_name: { type: 'string', description: 'Name of the recruiter (for tracking)' },
          company: { type: 'string', description: 'Company name (for tracking)' },
        },
        required: ['profile_url', 'message'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_bulk_message',
      description:
        'Send a templated message to multiple LinkedIn profiles. Use {name} and {company} as placeholders.',
      parameters: {
        type: 'object',
        properties: {
          profiles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                profileUrl: { type: 'string' },
                name: { type: 'string' },
                company: { type: 'string' },
              },
              required: ['profileUrl'],
            },
            description: 'Array of profile objects with profileUrl, name, and company',
          },
          message_template: {
            type: 'string',
            description: 'Message template with {name} and {company} placeholders',
          },
        },
        required: ['profiles', 'message_template'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'overleaf_read',
      description: 'Read the current content of a LaTeX document from Overleaf.',
      parameters: {
        type: 'object',
        properties: {
          project_url: { type: 'string', description: 'Overleaf project URL' },
        },
        required: ['project_url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'overleaf_replace',
      description: 'Find and replace text in an Overleaf LaTeX document.',
      parameters: {
        type: 'object',
        properties: {
          project_url: { type: 'string', description: 'Overleaf project URL' },
          search_text: { type: 'string', description: 'Text to find' },
          replace_text: { type: 'string', description: 'Text to replace with' },
        },
        required: ['project_url', 'search_text', 'replace_text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'overleaf_compile',
      description: 'Recompile the Overleaf project and download the PDF.',
      parameters: {
        type: 'object',
        properties: {
          project_url: { type: 'string', description: 'Overleaf project URL' },
        },
        required: ['project_url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_send',
      description: 'Send an email via Gmail.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject line' },
          body: { type: 'string', description: 'Email body text' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_read',
      description: 'Read recent emails from Gmail inbox.',
      parameters: {
        type: 'object',
        properties: {
          max_results: { type: 'number', description: 'Number of emails to return (default 10)' },
          query: { type: 'string', description: 'Gmail search query (e.g., "from:recruiter@company.com")' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_body',
      description: 'Get the full body of an email by message ID.',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID' },
        },
        required: ['message_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'gmail_label',
      description: 'Apply a label to a Gmail message. Labels: applied, interview, rejected, offer, follow-up',
      parameters: {
        type: 'object',
        properties: {
          message_id: { type: 'string', description: 'Gmail message ID' },
          label: { type: 'string', description: 'Label to apply (applied|interview|rejected|offer|follow-up)' },
        },
        required: ['message_id', 'label'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_followups',
      description: 'Get recruiters who were contacted but have not replied, for follow-up.',
      parameters: {
        type: 'object',
        properties: {
          days_since: { type: 'number', description: 'Days since contact (default 3)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_stats',
      description: 'Get overall job search statistics: total recruiters, contacted, replied, etc.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'save_job',
      description: 'Save a job listing to the database for tracking.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Job title' },
          company: { type: 'string', description: 'Company name' },
          url: { type: 'string', description: 'Job posting URL' },
          notes: { type: 'string', description: 'Any notes about the job' },
        },
        required: ['title', 'company'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_jobs',
      description: 'Get saved jobs from the database.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (saved|applied|interview|rejected|offer)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'clear_history',
      description: 'Clear the chat history for the current session.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  // ── General-purpose browser agent tools ──
  {
    type: 'function' as const,
    function: {
      name: 'linkedin_browse',
      description:
        'Browse any LinkedIn page and return its visible text content. Use for any LinkedIn question not covered by specific tools. ' +
        'Pass a full LinkedIn URL or a shortcut: "my profile", "my connections", "my network", "notifications", "messaging", "jobs", "feed", "who viewed me", "invitations", "my posts", "saved posts", "settings". ' +
        'Read-only — cannot click, post, or interact.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'A LinkedIn URL or shortcut keyword (e.g. "my connections", "notifications")',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_browse',
      description:
        'Navigate to any URL and return visible text content. Works on job boards, company pages, articles, etc. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Full URL to browse (e.g. "https://example.com/jobs")',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description:
        'Search Google and return results with titles, URLs, and snippets. Use to find job postings, company info, people, emails, etc.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Google search query (e.g. "ML engineer jobs San Francisco")',
          },
          max_results: {
            type: 'number',
            description: 'Maximum results to return (default 8)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_click',
      description:
        'Click a button or link on the current page by its visible text. Must call web_browse or linkedin_browse first to navigate to a page. Requires Pro/Premium plan.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Visible text of the button/link to click (e.g. "Apply Now", "Accept", "Next")',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_type',
      description:
        'Type text into an input field on the current page by its label or placeholder. Must call web_browse first. Requires Pro/Premium plan.',
      parameters: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            description: 'Label or placeholder text of the input field (e.g. "Email", "Search", "Name")',
          },
          value: {
            type: 'string',
            description: 'Text to type into the field',
          },
        },
        required: ['field', 'value'],
      },
    },
  },
];

// Filter tool definitions by user plan
export function getToolsForPlan(ctx: UserContext) {
  return toolDefinitions.filter((t) => isToolAllowed(ctx.plan, t.function.name));
}

// ── Tool executor ──

export async function executeTool(
  name: string,
  args: Record<string, any>,
  ctx: UserContext
): Promise<string> {
  // Plan gating
  if (!isToolAllowed(ctx.plan, name)) {
    return `🔒 *${name}* requires a Pro or Premium plan. Use /upgrade to unlock this feature.`;
  }

  try {
    switch (name) {
      case 'linkedin_login': {
        const creds = ctx.linkedinCredentials;
        if (!creds) return '❌ LinkedIn credentials not configured. Use /login_linkedin to set them up.';
        return await linkedinLogin(creds.email, creds.password, ctx.userId);
      }

      case 'linkedin_verify':
        return await linkedinVerify(args.code, ctx.userId);

      case 'linkedin_status':
        return await linkedinStatus(ctx.userId);

      case 'linkedin_search': {
        const searchResults = await linkedinSearch(args.query, args.max_results || 10, ctx.userId);
        if (searchResults.length === 0) return 'No results found.';
        return searchResults
          .map(
            (r, i) =>
              `${i + 1}. *${r.name}*${r.headline ? `\n   ${r.headline}` : ''}${r.location ? `\n   📍 ${r.location}` : ''}\n   🔗 ${r.profileUrl}`
          )
          .join('\n\n');
      }

      case 'linkedin_get_profile':
        return await linkedinGetProfile(args.profile_url, ctx.userId);

      case 'linkedin_message':
        return await linkedinMessage(
          args.profile_url,
          args.message,
          ctx.userId,
          args.recruiter_name,
          args.company
        );

      case 'linkedin_bulk_message':
        return await linkedinBulkMessage(args.profiles, args.message_template, ctx.userId);

      case 'overleaf_read':
        return await overleafRead(args.project_url || ctx.overleafUrl || '');

      case 'overleaf_replace':
        return await overleafReplace(
          args.project_url || ctx.overleafUrl || '',
          args.search_text,
          args.replace_text
        );

      case 'overleaf_compile':
        return await overleafCompile(args.project_url || ctx.overleafUrl || '');

      case 'gmail_send':
        return await gmailSend(args.to, args.subject, args.body);

      case 'gmail_read':
        return await gmailRead(args.max_results || 10, args.query);

      case 'gmail_body':
        return await gmailBody(args.message_id);

      case 'gmail_label':
        return await gmailLabel(args.message_id, args.label);

      case 'get_followups': {
        const followups = getPendingFollowups(ctx.userId, args.days_since || 3);
        if (followups.length === 0) return 'No pending follow-ups.';
        return followups
          .map(
            (r: any) =>
              `• *${r.name || 'Unknown'}*${r.company ? ` at ${r.company}` : ''}\n  Contacted: ${r.contacted_at}\n  🔗 ${r.profile_url}`
          )
          .join('\n\n');
      }

      case 'get_stats': {
        const stats = getStats(ctx.userId);
        return [
          `📊 *Job Search Stats*`,
          `Total recruiters found: *${stats.total_recruiters}*`,
          `Contacted: *${stats.contacted}*`,
          `Replied: *${stats.replied}*`,
          `Contacted today: *${stats.contacted_today}*/${ctx.limits.linkedinMessagesPerDay}`,
          `Jobs tracked: *${stats.total_jobs}*`,
        ].join('\n');
      }

      case 'save_job': {
        saveJob(ctx.userId, {
          title: args.title,
          company: args.company,
          url: args.url,
          notes: args.notes,
        });
        return `✅ Saved job: *${args.title}* at *${args.company}*`;
      }

      case 'get_jobs': {
        const jobs = getJobs(ctx.userId, args.status);
        if (jobs.length === 0) return 'No jobs found.';
        return jobs
          .map(
            (j: any) =>
              `• *${j.title}* at *${j.company}* [${j.status}]${j.url ? `\n  🔗 ${j.url}` : ''}${j.notes ? `\n  📝 ${j.notes}` : ''}`
          )
          .join('\n\n');
      }

      case 'clear_history':
        clearChatHistory(ctx.userId, ctx.userId);
        return '✅ Chat history cleared.';

      // ── General-purpose browser agent tools ──

      case 'linkedin_browse': {
        setLastBrowseContext(ctx.userId, true);
        return await linkedinBrowse(args.url, ctx.userId);
      }

      case 'web_browse': {
        // If it's a LinkedIn URL, redirect to linkedin_browse (uses auth)
        if (args.url && args.url.includes('linkedin.com')) {
          setLastBrowseContext(ctx.userId, true);
          return await linkedinBrowse(args.url, ctx.userId);
        }
        setLastBrowseContext(ctx.userId, false);
        return await webBrowse(args.url);
      }

      case 'web_search':
        setLastBrowseContext(ctx.userId, false);
        return await webSearch(args.query, args.max_results || 8);

      case 'web_click':
        return await webClick(args.text, ctx.userId);

      case 'web_type':
        return await webType(args.field, args.value, ctx.userId);

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (e: any) {
    log.error(`Tool ${name} error:`, e.message);
    return `Error in ${name}: ${e.message}`;
  }
}
