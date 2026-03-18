import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { log } from './logger';

const AUTH_DIR = path.join(process.cwd(), '.whatsapp_auth');

// Pino logger required by Baileys internals (needs .trace, .child, .level, etc.)
const baileysLogger = pino({ level: 'silent' });

let activeSendMessage: Function | null = null;

type MessageHandler = (jid: string, text: string) => Promise<string>;

export async function startWhatsApp(
  onMessage: MessageHandler
): Promise<{ sendMessage: (jid: string, text: string) => Promise<void> }> {
  async function createSocket() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Fetch the latest WA version so the server doesn't reject us (405)
    const { version } = await fetchLatestBaileysVersion();
    log.info('WhatsApp: using WA version', version.join('.'));

    const sock: WASocket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      version,
      logger: baileysLogger,
      browser: Browsers.ubuntu('Chrome'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Display QR code when received
      if (qr) {
        log.info('WhatsApp: scan this QR code with your phone ⬇');
        qrcode.generate(qr, { small: true });
        // Also save as PNG for easy viewing
        const qrPath = path.join(process.cwd(), 'whatsapp_qr.png');
        QRCode.toFile(qrPath, qr, { width: 400 }).then(() => {
          log.info(`WhatsApp: QR code saved to ${qrPath} — open this file to scan`);
        }).catch(() => {});
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        log.warn(`WhatsApp connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => {
            log.info('WhatsApp: attempting reconnection...');
            createSocket();
          }, 10000);
        } else {
          log.warn('WhatsApp: logged out. Deleting auth and recreating...');
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch (_) {}
          createSocket();
        }
      }

      if (connection === 'open') {
        log.info('WhatsApp: connected successfully ✅');
      }
    });

    // Track message IDs we sent so we don't loop on self-chat
    const sentMessageIds = new Set<string>();

    // Update the mutable send pointer
    activeSendMessage = async (jid: string, text: string) => {
      const sent = await sock.sendMessage(jid, { text });
      if (sent?.key?.id) sentMessageIds.add(sent.key.id);
      // Keep set from growing unbounded
      if (sentMessageIds.size > 100) {
        const first = sentMessageIds.values().next().value;
        if (first) sentMessageIds.delete(first);
      }
    };

    // Message handler
    sock.ev.on('messages.upsert', async (m) => {
      try {
        log.info(`WhatsApp: messages.upsert fired — type=${m.type}, count=${m.messages.length}`);

        // Only process new incoming messages, not history sync
        if (m.type !== 'notify') {
          log.info(`WhatsApp: skipping non-notify upsert (type=${m.type})`);
          return;
        }

        const msg = m.messages[0];
        if (!msg?.message) {
          log.info('WhatsApp: message has no content, skipping');
          return;
        }

        const jid = msg.key.remoteJid;
        if (!jid) { log.info('WhatsApp: no remoteJid, skipping'); return; }

        log.info(`WhatsApp: msg from jid=${jid}, fromMe=${msg.key.fromMe}, msgType=${Object.keys(msg.message || {}).join(',')}`);

        // Ignore group messages, broadcasts, and newsletters — only respond to DMs
        if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) {
          log.info(`WhatsApp: skipping group/broadcast/newsletter: ${jid}`);
          return;
        }

        // Skip messages we sent ourselves (prevents self-chat echo loop)
        if (msg.key.fromMe) {
          // In self-chat: only process if it's a genuine user-typed message (not one we sent via API)
          const myJid = sock.user?.id?.split(':')[0] || '';
          const isSelfChat = (myJid && jid.startsWith(myJid)) || jid.endsWith('@lid');
          if (!isSelfChat) {
            log.info(`WhatsApp: skipping fromMe message (not self-chat). myJid=${myJid}, jid=${jid}`);
            return;
          }
          // Skip if this is a message we sent as Jarvis
          if (sentMessageIds.has(msg.key.id || '')) {
            log.info('WhatsApp: skipping our own sent message');
            return;
          }
          log.info(`WhatsApp: processing self-chat message from ${jid}`);
        }

        // For LID-based JIDs, resolve to the phone number JID for sending replies
        let replyJid = jid;
        if (jid.endsWith('@lid')) {
          const myJid = sock.user?.id?.split(':')[0] || '';
          if (myJid) {
            replyJid = `${myJid}@s.whatsapp.net`;
            log.info(`WhatsApp: LID detected, will reply to ${replyJid} instead of ${jid}`);
          }
        }

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          '';

        if (!text.trim()) {
          log.info(`WhatsApp: empty text body, skipping. Keys: ${Object.keys(msg.message || {})}`);
          return;
        }

        log.info(`WhatsApp message from ${jid}: ${text.slice(0, 100)}`);

        const response = await onMessage(replyJid, text.trim());

        if (response && activeSendMessage) {
          log.info(`WhatsApp: sending response to ${replyJid} (${response.length} chars)`);
          const chunks = splitMessage(response, 4000);
          for (const chunk of chunks) {
            await activeSendMessage(replyJid, chunk);
            if (chunks.length > 1) {
              await new Promise((r) => setTimeout(r, 500));
            }
          }
          log.info(`WhatsApp: response sent successfully`);
        } else {
          log.warn(`WhatsApp: no response generated or no active connection. response=${!!response}, sendFn=${!!activeSendMessage}`);
        }
      } catch (e: any) {
        log.error('WhatsApp message handler error:', e.message, e.stack?.slice(0, 300));

        const errorJid = m.messages[0]?.key?.remoteJid;
        let errorReplyJid = errorJid;
        if (errorJid?.endsWith('@lid')) {
          const myJid = sock.user?.id?.split(':')[0] || '';
          if (myJid) errorReplyJid = `${myJid}@s.whatsapp.net`;
        }
        if (errorReplyJid && activeSendMessage) {
          try {
            await activeSendMessage(errorReplyJid, '⚠️ Something went wrong. Please try again.');
          } catch (_) {}
        }
      }
    });
  }

  await createSocket();

  return {
    sendMessage: async (jid: string, text: string) => {
      if (!activeSendMessage) {
        log.error('WhatsApp: no active connection to send message');
        return;
      }
      const chunks = splitMessage(text, 4000);
      for (const chunk of chunks) {
        await activeSendMessage(jid, chunk);
        if (chunks.length > 1) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    },
  };
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) {
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt < maxLen * 0.3) {
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
