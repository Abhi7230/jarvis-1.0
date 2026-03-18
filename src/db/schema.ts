import Database from 'better-sqlite3';
import path from 'path';
import { log } from '../logger';
import { PlanType } from '../plans';

const DB_PATH = path.join(process.env.DATA_DIR || process.cwd(), 'jarvis.db');

let db: Database.Database;

export function initDb(): Database.Database {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    -- Users table (multi-tenant)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      telegram_username TEXT,
      email TEXT,
      name TEXT,
      plan TEXT DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'inactive',
      linkedin_credentials TEXT,
      gmail_token TEXT,
      overleaf_url TEXT,
      daily_searches_used INTEGER DEFAULT 0,
      daily_messages_used INTEGER DEFAULT 0,
      daily_reset_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recruiters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '__legacy__',
      name TEXT,
      profile_url TEXT NOT NULL,
      headline TEXT,
      company TEXT,
      location TEXT,
      connection_degree TEXT,
      message_sent TEXT,
      contacted_at TEXT,
      replied INTEGER DEFAULT 0,
      replied_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, profile_url)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '__legacy__',
      recruiter_id INTEGER,
      direction TEXT NOT NULL,
      content TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (recruiter_id) REFERENCES recruiters(id)
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '__legacy__',
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT '__legacy__',
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      url TEXT,
      status TEXT DEFAULT 'saved',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
  `);

  // Run migrations for existing DBs (adds user_id columns if missing)
  migrateIfNeeded();

  // Create indexes that depend on user_id (after migration)
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_recruiters_user ON recruiters(user_id, profile_url);
      CREATE INDEX IF NOT EXISTS idx_chat_user_session ON chat_history(user_id, session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
    `);
  } catch (_) {}

  log.info('Database initialized at', DB_PATH);
  return db;
}

function migrateIfNeeded() {
  // Add user_id columns to existing tables if they don't exist
  const tables = ['recruiters', 'messages', 'chat_history', 'jobs'];
  for (const table of tables) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
      const hasUserId = cols.some((c: any) => c.name === 'user_id');
      if (!hasUserId) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT '__legacy__'`);
        log.info(`Migration: added user_id column to ${table}`);
      }
    } catch (_) {}
  }

  // Drop old unique index on recruiters.profile_url and create new composite one
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_recruiters_user_profile ON recruiters(user_id, profile_url)`);
  } catch (_) {}
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ── User queries ──

export function createUser(data: {
  id: string;
  telegram_id?: string;
  telegram_username?: string;
  name?: string;
  email?: string;
}): any {
  const stmt = getDb().prepare(`
    INSERT INTO users (id, telegram_id, telegram_username, name, email)
    VALUES (@id, @telegram_id, @telegram_username, @name, @email)
    ON CONFLICT(telegram_id) DO UPDATE SET
      telegram_username = COALESCE(@telegram_username, telegram_username),
      name = COALESCE(@name, name),
      updated_at = datetime('now')
  `);
  stmt.run({
    id: data.id,
    telegram_id: data.telegram_id || null,
    telegram_username: data.telegram_username || null,
    name: data.name || null,
    email: data.email || null,
  });
  return getUserByTelegramId(data.telegram_id || '');
}

export function getUserById(userId: string): any {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

export function getUserByTelegramId(telegramId: string): any {
  return getDb().prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

export function updateUser(userId: string, data: Record<string, any>) {
  const fields = Object.keys(data)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  const stmt = getDb().prepare(`UPDATE users SET ${fields}, updated_at = datetime('now') WHERE id = @id`);
  stmt.run({ ...data, id: userId });
}

export function getActiveSubscribedUsers(): any[] {
  return getDb()
    .prepare("SELECT * FROM users WHERE plan != 'free' AND subscription_status = 'active'")
    .all();
}

export function getAllUsers(): any[] {
  return getDb().prepare('SELECT * FROM users').all();
}

export function resetDailyUsage(userId: string) {
  getDb()
    .prepare(
      "UPDATE users SET daily_searches_used = 0, daily_messages_used = 0, daily_reset_at = datetime('now') WHERE id = ?"
    )
    .run(userId);
}

export function incrementDailySearches(userId: string) {
  checkAndResetDaily(userId);
  getDb()
    .prepare('UPDATE users SET daily_searches_used = daily_searches_used + 1 WHERE id = ?')
    .run(userId);
}

export function incrementDailyMessages(userId: string) {
  checkAndResetDaily(userId);
  getDb()
    .prepare('UPDATE users SET daily_messages_used = daily_messages_used + 1 WHERE id = ?')
    .run(userId);
}

function checkAndResetDaily(userId: string) {
  const user = getUserById(userId);
  if (!user) return;
  const resetAt = user.daily_reset_at;
  if (!resetAt || new Date(resetAt).toDateString() !== new Date().toDateString()) {
    resetDailyUsage(userId);
  }
}

// ── Recruiter queries ──

export function upsertRecruiter(
  userId: string,
  data: {
    name: string;
    profile_url: string;
    headline?: string;
    company?: string;
    location?: string;
    connection_degree?: string;
  }
) {
  const stmt = getDb().prepare(`
    INSERT INTO recruiters (user_id, name, profile_url, headline, company, location, connection_degree)
    VALUES (@user_id, @name, @profile_url, @headline, @company, @location, @connection_degree)
    ON CONFLICT(user_id, profile_url) DO UPDATE SET
      name = COALESCE(@name, name),
      headline = COALESCE(@headline, headline),
      company = COALESCE(@company, company),
      location = COALESCE(@location, location),
      connection_degree = COALESCE(@connection_degree, connection_degree)
  `);
  return stmt.run({
    user_id: userId,
    name: data.name || null,
    profile_url: data.profile_url,
    headline: data.headline || null,
    company: data.company || null,
    location: data.location || null,
    connection_degree: data.connection_degree || null,
  });
}

export function markRecruiterContacted(userId: string, profileUrl: string, message: string) {
  const stmt = getDb().prepare(`
    UPDATE recruiters
    SET contacted_at = datetime('now'), message_sent = @message
    WHERE user_id = @userId AND profile_url = @profileUrl
  `);
  return stmt.run({ userId, profileUrl, message });
}

export function markRecruiterReplied(userId: string, profileUrl: string) {
  const stmt = getDb().prepare(`
    UPDATE recruiters
    SET replied = 1, replied_at = datetime('now')
    WHERE user_id = @userId AND profile_url = @profileUrl
  `);
  return stmt.run({ userId, profileUrl });
}

export function isRecruiterContacted(userId: string, profileUrl: string): boolean {
  const row = getDb()
    .prepare(
      'SELECT contacted_at FROM recruiters WHERE user_id = ? AND profile_url = ? AND contacted_at IS NOT NULL'
    )
    .get(userId, profileUrl) as any;
  return !!row;
}

export function getContactedToday(userId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM recruiters
       WHERE user_id = ?
         AND contacted_at >= date('now')
         AND contacted_at < date('now', '+1 day')`
    )
    .get(userId) as any;
  return row?.count || 0;
}

export function getPendingFollowups(userId: string, daysSince: number = 3): any[] {
  return getDb()
    .prepare(
      `SELECT id, name, profile_url, company, contacted_at, message_sent
       FROM recruiters
       WHERE user_id = @userId
         AND contacted_at IS NOT NULL
         AND replied = 0
         AND contacted_at <= datetime('now', '-' || @days || ' days')
       ORDER BY contacted_at ASC`
    )
    .all({ userId, days: daysSince });
}

export function getRecruiterByUrl(userId: string, profileUrl: string): any {
  return getDb()
    .prepare('SELECT * FROM recruiters WHERE user_id = ? AND profile_url = ?')
    .get(userId, profileUrl);
}

// ── Chat history queries ──

export function saveMessage(userId: string, sessionId: string, role: string, content: string) {
  getDb()
    .prepare(
      'INSERT INTO chat_history (user_id, session_id, role, content) VALUES (?, ?, ?, ?)'
    )
    .run(userId, sessionId, role, content);
}

export function getHistory(userId: string, sessionId: string, limit: number = 10): any[] {
  const rows = getDb()
    .prepare(
      `SELECT role, content FROM chat_history
       WHERE user_id = ? AND session_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(userId, sessionId, limit) as any[];
  return rows.reverse();
}

export function clearChatHistory(userId: string, sessionId: string) {
  getDb()
    .prepare('DELETE FROM chat_history WHERE user_id = ? AND session_id = ?')
    .run(userId, sessionId);
}

// ── Job queries ──

export function saveJob(
  userId: string,
  data: {
    title: string;
    company: string;
    url?: string;
    notes?: string;
  }
) {
  const stmt = getDb().prepare(`
    INSERT INTO jobs (user_id, title, company, url, notes)
    VALUES (@user_id, @title, @company, @url, @notes)
  `);
  return stmt.run({
    user_id: userId,
    title: data.title,
    company: data.company,
    url: data.url || null,
    notes: data.notes || null,
  });
}

export function getJobs(userId: string, status?: string): any[] {
  if (status) {
    return getDb()
      .prepare('SELECT * FROM jobs WHERE user_id = ? AND status = ? ORDER BY created_at DESC')
      .all(userId, status);
  }
  return getDb()
    .prepare('SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

export function updateJobStatus(userId: string, jobId: number, status: string) {
  getDb()
    .prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE user_id = ? AND id = ?")
    .run(status, userId, jobId);
}

// ── Stats ──

export function getStats(userId: string): {
  total_recruiters: number;
  contacted: number;
  replied: number;
  contacted_today: number;
  total_jobs: number;
} {
  const total = (
    getDb().prepare('SELECT COUNT(*) as c FROM recruiters WHERE user_id = ?').get(userId) as any
  ).c;
  const contacted = (
    getDb()
      .prepare(
        'SELECT COUNT(*) as c FROM recruiters WHERE user_id = ? AND contacted_at IS NOT NULL'
      )
      .get(userId) as any
  ).c;
  const replied = (
    getDb()
      .prepare('SELECT COUNT(*) as c FROM recruiters WHERE user_id = ? AND replied = 1')
      .get(userId) as any
  ).c;
  const today = getContactedToday(userId);
  const jobs = (
    getDb().prepare('SELECT COUNT(*) as c FROM jobs WHERE user_id = ?').get(userId) as any
  ).c;

  return {
    total_recruiters: total,
    contacted,
    replied,
    contacted_today: today,
    total_jobs: jobs,
  };
}
