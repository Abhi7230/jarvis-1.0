import fs from 'fs';
import path from 'path';
import { log } from '../logger';

const CREDENTIALS_PATH = path.join(process.cwd(), 'gmail_credentials.json');
const TOKEN_PATH = path.join(process.cwd(), '.gmail_token.json');

let gmailClient: any = null;

async function getGmail() {
  if (gmailClient) return gmailClient;

  if (!fs.existsSync(CREDENTIALS_PATH) || !fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      'Gmail not configured. Run `npm run gmail-auth` first.'
    );
  }

  // Lazy load googleapis
  const { google } = await import('googleapis');

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));

  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
  );
  oAuth2Client.setCredentials(tokens);

  // Auto-refresh tokens
  oAuth2Client.on('tokens', (newTokens: any) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
    log.info('Gmail: tokens refreshed');
  });

  gmailClient = google.gmail({ version: 'v1', auth: oAuth2Client });
  return gmailClient;
}

export async function gmailSend(
  to: string,
  subject: string,
  body: string
): Promise<string> {
  try {
    const gmail = await getGmail();

    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');

    const encodedMessage = Buffer.from(message).toString('base64url');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    log.info(`Gmail: sent email to ${to}`);
    return `✅ Email sent to *${to}*: "${subject}"`;
  } catch (e: any) {
    log.error('Gmail send error:', e.message);
    return `Error sending email: ${e.message}`;
  }
}

export async function gmailRead(
  maxResults: number = 10,
  query?: string
): Promise<string> {
  try {
    const gmail = await getGmail();

    const res = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query || '',
    });

    const messages = res.data.messages || [];
    if (messages.length === 0) {
      return 'No emails found.';
    }

    const results: string[] = [];

    for (const msg of messages.slice(0, maxResults)) {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = full.data.payload?.headers || [];
      const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
      const date = headers.find((h: any) => h.name === 'Date')?.value || '';
      const snippet = full.data.snippet || '';
      const labels = (full.data.labelIds || []).join(', ');

      results.push(
        `📧 *${subject}*\nFrom: ${from}\nDate: ${date}\nID: ${msg.id}\nLabels: ${labels}\n${snippet}\n`
      );
    }

    return results.join('\n---\n');
  } catch (e: any) {
    log.error('Gmail read error:', e.message);
    return `Error reading emails: ${e.message}`;
  }
}

export async function gmailBody(messageId: string): Promise<string> {
  try {
    const gmail = await getGmail();

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const payload = res.data.payload;
    let body = '';

    function extractBody(part: any): string {
      if (part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      if (part.parts) {
        for (const p of part.parts) {
          // Prefer text/plain
          if (p.mimeType === 'text/plain' && p.body?.data) {
            return Buffer.from(p.body.data, 'base64').toString('utf-8');
          }
        }
        // Fallback to text/html
        for (const p of part.parts) {
          if (p.mimeType === 'text/html' && p.body?.data) {
            const html = Buffer.from(p.body.data, 'base64').toString('utf-8');
            // Strip HTML tags for readability
            return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }
        }
        // Recurse into nested parts
        for (const p of part.parts) {
          const result = extractBody(p);
          if (result) return result;
        }
      }
      return '';
    }

    body = extractBody(payload);

    if (!body) {
      body = res.data.snippet || 'Could not extract email body.';
    }

    const headers = payload?.headers || [];
    const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
    const date = headers.find((h: any) => h.name === 'Date')?.value || '';

    return `*${subject}*\nFrom: ${from}\nDate: ${date}\n\n${body}`;
  } catch (e: any) {
    log.error('Gmail body error:', e.message);
    return `Error reading email body: ${e.message}`;
  }
}

export async function gmailLabel(
  messageId: string,
  label: string
): Promise<string> {
  try {
    const gmail = await getGmail();

    // Get or create the label
    const labelsRes = await gmail.users.labels.list({ userId: 'me' });
    const labels = labelsRes.data.labels || [];

    const normalizedLabel = label.toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    let labelId = labels.find(
      (l: any) =>
        l.name?.toUpperCase() === normalizedLabel || l.name?.toUpperCase() === label.toUpperCase()
    )?.id;

    if (!labelId) {
      // Create the label
      const createRes = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: label,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      labelId = createRes.data.id;
      log.info(`Gmail: created label "${label}"`);
    }

    // Apply the label
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId],
      },
    });

    log.info(`Gmail: labeled message ${messageId} as "${label}"`);
    return `✅ Email labeled as *${label}*`;
  } catch (e: any) {
    log.error('Gmail label error:', e.message);
    return `Error labeling email: ${e.message}`;
  }
}
