import Database from 'better-sqlite3';
import path from 'path';
import { log } from '../logger';

const DB_PATH = path.join(process.cwd(), 'jarvis.db');

let db: Database.Database;

export function initDb(): Database.Database {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS recruiters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      profile_url TEXT UNIQUE NOT NULL,
      headline TEXT,
      company TEXT,
      location TEXT,
      connection_degree TEXT,
      message_sent TEXT,
      contacted_at TEXT,
      replied INTEGER DEFAULT 0,
      replied_at TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recruiter_id INTEGER,
      direction TEXT NOT NULL,
      content TEXT NOT NULL,
      sent_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (recruiter_id) REFERENCES recruiters(id)
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      url TEXT,
      status TEXT DEFAULT 'saved',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_recruiters_profile ON recruiters(profile_url);
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_history(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
  `);

  log.info('Database initialized at', DB_PATH);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ── Recruiter queries ──

export function upsertRecruiter(data: {
  name: string;
  profile_url: string;
  headline?: string;
  company?: string;
  location?: string;
  connection_degree?: string;
}) {
  const stmt = getDb().prepare(`
    INSERT INTO recruiters (name, profile_url, headline, company, location, connection_degree)
    VALUES (@name, @profile_url, @headline, @company, @location, @connection_degree)
    ON CONFLICT(profile_url) DO UPDATE SET
      name = COALESCE(@name, name),
      headline = COALESCE(@headline, headline),
      company = COALESCE(@company, company),
      location = COALESCE(@location, location),
      connection_degree = COALESCE(@connection_degree, connection_degree)
  `);
  return stmt.run({
    name: data.name || null,
    profile_url: data.profile_url,
    headline: data.headline || null,
    company: data.company || null,
    location: data.location || null,
    connection_degree: data.connection_degree || null,
  });
}

export function markRecruiterContacted(profileUrl: string, message: string) {
  const stmt = getDb().prepare(`
    UPDATE recruiters
    SET contacted_at = datetime('now'), message_sent = @message
    WHERE profile_url = @profileUrl
  `);
  return stmt.run({ profileUrl, message });
}

export function markRecruiterReplied(profileUrl: string) {
  const stmt = getDb().prepare(`
    UPDATE recruiters
    SET replied = 1, replied_at = datetime('now')
    WHERE profile_url = @profileUrl
  `);
  return stmt.run({ profileUrl });
}

export function isRecruiterContacted(profileUrl: string): boolean {
  const row = getDb()
    .prepare('SELECT contacted_at FROM recruiters WHERE profile_url = ? AND contacted_at IS NOT NULL')
    .get(profileUrl) as any;
  return !!row;
}

export function getContactedToday(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) as count FROM recruiters
       WHERE contacted_at >= date('now')
         AND contacted_at < date('now', '+1 day')`
    )
    .get() as any;
  return row?.count || 0;
}

export function getPendingFollowups(daysSince: number = 3): any[] {
  return getDb()
    .prepare(
      `SELECT id, name, profile_url, company, contacted_at, message_sent
       FROM recruiters
       WHERE contacted_at IS NOT NULL
         AND replied = 0
         AND contacted_at <= datetime('now', '-' || @days || ' days')
       ORDER BY contacted_at ASC`
    )
    .all({ days: daysSince });
}

export function getRecruiterByUrl(profileUrl: string): any {
  return getDb()
    .prepare('SELECT * FROM recruiters WHERE profile_url = ?')
    .get(profileUrl);
}

// ── Chat history queries ──

export function saveMessage(sessionId: string, role: string, content: string) {
  getDb()
    .prepare('INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)')
    .run(sessionId, role, content);
}

export function getHistory(sessionId: string, limit: number = 10): any[] {
  const rows = getDb()
    .prepare(
      `SELECT role, content FROM chat_history
       WHERE session_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`
    )
    .all(sessionId, limit) as any[];
  return rows.reverse();
}

export function clearChatHistory(sessionId: string) {
  getDb()
    .prepare('DELETE FROM chat_history WHERE session_id = ?')
    .run(sessionId);
}

// ── Job queries ──

export function saveJob(data: {
  title: string;
  company: string;
  url?: string;
  notes?: string;
}) {
  const stmt = getDb().prepare(`
    INSERT INTO jobs (title, company, url, notes)
    VALUES (@title, @company, @url, @notes)
  `);
  return stmt.run({
    title: data.title,
    company: data.company,
    url: data.url || null,
    notes: data.notes || null,
  });
}

export function getJobs(status?: string): any[] {
  if (status) {
    return getDb()
      .prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC')
      .all(status);
  }
  return getDb()
    .prepare('SELECT * FROM jobs ORDER BY created_at DESC')
    .all();
}

export function updateJobStatus(jobId: number, status: string) {
  getDb()
    .prepare("UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, jobId);
}

// ── Stats ──

export function getStats(): {
  total_recruiters: number;
  contacted: number;
  replied: number;
  contacted_today: number;
  total_jobs: number;
} {
  const total = (
    getDb().prepare('SELECT COUNT(*) as c FROM recruiters').get() as any
  ).c;
  const contacted = (
    getDb()
      .prepare('SELECT COUNT(*) as c FROM recruiters WHERE contacted_at IS NOT NULL')
      .get() as any
  ).c;
  const replied = (
    getDb()
      .prepare('SELECT COUNT(*) as c FROM recruiters WHERE replied = 1')
      .get() as any
  ).c;
  const today = getContactedToday();
  const jobs = (
    getDb().prepare('SELECT COUNT(*) as c FROM jobs').get() as any
  ).c;

  return {
    total_recruiters: total,
    contacted,
    replied,
    contacted_today: today,
    total_jobs: jobs,
  };
}
