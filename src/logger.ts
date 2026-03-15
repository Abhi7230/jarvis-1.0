import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'jarvis.log');

const SENSITIVE_PATTERNS = [
  /("?password"?\s*[:=]\s*)"[^"]*"/gi,
  /("?token"?\s*[:=]\s*)"[^"]*"/gi,
  /("?cookie"?\s*[:=]\s*)"[^"]*"/gi,
  /("?api_key"?\s*[:=]\s*)"[^"]*"/gi,
  /("?secret"?\s*[:=]\s*)"[^"]*"/gi,
  /("?authorization"?\s*[:=]\s*)"[^"]*"/gi,
  /(gsk_)[a-zA-Z0-9]+/g,
  /(AIzaSy)[a-zA-Z0-9_-]+/g,
  /(Bearer\s+)[a-zA-Z0-9._-]+/gi,
];

function redact(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '$1[REDACTED]');
  }
  return result;
}

function timestamp(): string {
  return new Date().toISOString();
}

function writeToFile(line: string) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {
    // EPIPE or disk error — never crash
  }
}

function formatArgs(args: any[]): string {
  return args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ');
}

export const log = {
  info(...args: any[]) {
    const msg = redact(`[${timestamp()}] INFO  ${formatArgs(args)}`);
    console.log(msg);
    writeToFile(msg);
  },
  warn(...args: any[]) {
    const msg = redact(`[${timestamp()}] WARN  ${formatArgs(args)}`);
    console.warn(msg);
    writeToFile(msg);
  },
  error(...args: any[]) {
    const msg = redact(`[${timestamp()}] ERROR ${formatArgs(args)}`);
    console.error(msg);
    writeToFile(msg);
  },
  debug(...args: any[]) {
    const msg = redact(`[${timestamp()}] DEBUG ${formatArgs(args)}`);
    if (process.env.DEBUG) console.log(msg);
    writeToFile(msg);
  },
};
