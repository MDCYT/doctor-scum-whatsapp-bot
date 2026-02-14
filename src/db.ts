import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config, defaults } from './config';

export type SessionRow = {
  id: number;
  wa_chat_id: string;
  name: string;
  is_active: number;
  summary: string | null;
  last_active: string;
  created_at: string;
};

export type MessageRow = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

class Db {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    this.ensureDefaults();
  }

  private migrate() {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS authorized_users (
        jid TEXT PRIMARY KEY,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS authorized_groups (
        jid TEXT PRIMARY KEY,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS linked_numbers (
        primary_jid TEXT NOT NULL,
        linked_jid TEXT NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(primary_jid, linked_jid)
      );`,
      `CREATE INDEX IF NOT EXISTS idx_linked_primary ON linked_numbers(primary_jid);`,
      `CREATE INDEX IF NOT EXISTS idx_linked_linked ON linked_numbers(linked_jid);`,
      `CREATE TABLE IF NOT EXISTS bot_jids (
        chat_id TEXT PRIMARY KEY,
        bot_jid TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS chat_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wa_chat_id TEXT NOT NULL,
        name TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        summary TEXT,
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(wa_chat_id, name)
      );`,
      `CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );`,
      `CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id);`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_active ON chat_sessions(wa_chat_id, is_active);`
    ];

    const already = (this.db.prepare('PRAGMA user_version').get() as any).user_version as number;
    if (already === 0) {
      this.db.transaction(() => migrations.forEach((sql) => this.db.prepare(sql).run()))();
      this.db.prepare('PRAGMA user_version = 3').run();
    } else if (already === 1) {
      const v2Migrations = migrations.slice(3, 6);
      this.db.transaction(() => v2Migrations.forEach((sql) => this.db.prepare(sql).run()))();
      this.db.prepare('PRAGMA user_version = 2').run();
    } else if (already === 2) {
      const v3Migrations = [migrations[6]];
      this.db.transaction(() => v3Migrations.forEach((sql) => this.db.prepare(sql).run()))();
      this.db.prepare('PRAGMA user_version = 3').run();
    }
  }

  private ensureDefaults() {
    const persona = this.getConfig('persona');
    if (!persona) {
      this.setConfig('persona', defaults.persona);
    }
    const temp = this.getConfig('temperature');
    if (!temp) {
      this.setConfig('temperature', String(config.temperature));
    }
  }

  getConfig(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string) {
    this.db.prepare('INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }

  isUserAuthorized(jid: string): boolean {
    return !!this.db.prepare('SELECT jid FROM authorized_users WHERE jid = ?').get(jid);
  }

  authorizeUser(jid: string) {
    this.db.prepare('INSERT OR IGNORE INTO authorized_users(jid) VALUES(?)').run(jid);
  }

  deauthorizeUser(jid: string) {
    this.db.prepare('DELETE FROM authorized_users WHERE jid = ?').run(jid);
  }

  listUsers(): string[] {
    const rows = this.db.prepare('SELECT jid FROM authorized_users ORDER BY added_at DESC').all() as { jid: string }[];
    return rows.map((r) => r.jid);
  }

  isGroupAuthorized(jid: string): boolean {
    return !!this.db.prepare('SELECT jid FROM authorized_groups WHERE jid = ?').get(jid);
  }

  authorizeGroup(jid: string) {
    this.db.prepare('INSERT OR IGNORE INTO authorized_groups(jid) VALUES(?)').run(jid);
  }

  deauthorizeGroup(jid: string) {
    this.db.prepare('DELETE FROM authorized_groups WHERE jid = ?').run(jid);
  }

  listGroups(): string[] {
    const rows = this.db.prepare('SELECT jid FROM authorized_groups ORDER BY added_at DESC').all() as { jid: string }[];
    return rows.map((r) => r.jid);
  }

  getActiveSession(chatId: string): SessionRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM chat_sessions WHERE wa_chat_id = ? AND is_active = 1 ORDER BY last_active DESC LIMIT 1')
      .get(chatId) as SessionRow | undefined;
    return row;
  }

  getSessionByName(chatId: string, name: string): SessionRow | undefined {
    return this.db
      .prepare('SELECT * FROM chat_sessions WHERE wa_chat_id = ? AND name = ? LIMIT 1')
      .get(chatId, name) as SessionRow | undefined;
  }

  createSession(chatId: string, name: string): SessionRow {
    this.db.transaction(() => {
      this.db.prepare('UPDATE chat_sessions SET is_active = 0 WHERE wa_chat_id = ?').run(chatId);
      this.db
        .prepare(
          'INSERT INTO chat_sessions(wa_chat_id, name, is_active, last_active) VALUES(?, ?, 1, CURRENT_TIMESTAMP) ON CONFLICT(wa_chat_id, name) DO UPDATE SET is_active=1, last_active=CURRENT_TIMESTAMP'
        )
        .run(chatId, name);
    })();
    return this.getSessionByName(chatId, name)!;
  }

  activateSession(chatId: string, name: string): SessionRow | undefined {
    const exists = this.getSessionByName(chatId, name);
    if (!exists) return undefined;
    this.db.transaction(() => {
      this.db.prepare('UPDATE chat_sessions SET is_active = 0 WHERE wa_chat_id = ?').run(chatId);
      this.db
        .prepare('UPDATE chat_sessions SET is_active = 1, last_active = CURRENT_TIMESTAMP WHERE wa_chat_id = ? AND name = ?')
        .run(chatId, name);
    })();
    return this.getSessionByName(chatId, name);
  }

  closeSession(sessionId: number) {
    this.db.prepare('UPDATE chat_sessions SET is_active = 0 WHERE id = ?').run(sessionId);
  }

  updateLastActive(sessionId: number) {
    this.db.prepare('UPDATE chat_sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(sessionId);
  }

  addMessage(sessionId: number, role: 'user' | 'assistant', content: string) {
    this.db.prepare('INSERT INTO chat_messages(session_id, role, content) VALUES(?, ?, ?)').run(sessionId, role, content);
    this.updateLastActive(sessionId);
  }

  getMessages(sessionId: number): MessageRow[] {
    return this.db
      .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC')
      .all(sessionId) as MessageRow[];
  }

  deleteOldMessages(sessionId: number, keepLast: number) {
    this.db
      .prepare(
        'DELETE FROM chat_messages WHERE id IN (SELECT id FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)' // delete all except last N
      )
      .run(sessionId, keepLast);
  }

  saveSummary(sessionId: number, summary: string) {
    this.db.prepare('UPDATE chat_sessions SET summary = ? WHERE id = ?').run(summary, sessionId);
  }

  resetSession(sessionId: number) {
    this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    this.db.prepare('UPDATE chat_sessions SET summary = NULL WHERE id = ?').run(sessionId);
    this.updateLastActive(sessionId);
  }

  listSessions(chatId: string): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM chat_sessions WHERE wa_chat_id = ? ORDER BY last_active DESC, created_at DESC')
      .all(chatId) as SessionRow[];
  }

  linkNumber(primaryJid: string, linkedJid: string) {
    this.db
      .prepare('INSERT OR IGNORE INTO linked_numbers(primary_jid, linked_jid) VALUES(?, ?)')
      .run(primaryJid, linkedJid);
  }

  unlinkNumber(primaryJid: string, linkedJid: string) {
    this.db.prepare('DELETE FROM linked_numbers WHERE primary_jid = ? AND linked_jid = ?').run(primaryJid, linkedJid);
  }

  getLinkedNumbers(jid: string): string[] {
    const rows = this.db
      .prepare('SELECT primary_jid, linked_jid FROM linked_numbers WHERE primary_jid = ? OR linked_jid = ?')
      .all(jid, jid) as { primary_jid: string; linked_jid: string }[];
    const set = new Set<string>([jid]);
    rows.forEach((r) => {
      set.add(r.primary_jid);
      set.add(r.linked_jid);
    });
    return Array.from(set);
  }

  getBotJid(chatId: string): string | null {
    const row = this.db.prepare('SELECT bot_jid FROM bot_jids WHERE chat_id = ?').get(chatId) as { bot_jid: string } | undefined;
    return row?.bot_jid || null;
  }

  setBotJid(chatId: string, jid: string) {
    this.db
      .prepare('INSERT INTO bot_jids(chat_id, bot_jid, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) ON CONFLICT(chat_id) DO UPDATE SET bot_jid=excluded.bot_jid, updated_at=CURRENT_TIMESTAMP')
      .run(chatId, jid);
  }
}

export const db = new Db(config.dbPath);
