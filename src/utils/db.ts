import { Database } from 'bun:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'

export function getDbPath(): string {
  // テスト環境ではin-memory DBを使用
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return ':memory:'
  }
  return (
    process.env.DISCORD_NOTIFY_QUEUE_DB_PATH ||
    path.join(os.homedir(), '.config', 'opencode', 'discord-notify-queue.db')
  )
}

export function initDatabase(): Database {
  const dbPath = getDbPath()

  // in-memory DBの場合はディレクトリ作成をスキップ
  if (dbPath !== ':memory:') {
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }
  }

  const db = new Database(dbPath)

  // WALモード有効化（パフォーマンス向上）
  db.run('PRAGMA journal_mode = WAL;')

  // テーブル作成
  db.run(`
    CREATE TABLE IF NOT EXISTS discord_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      webhook_body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT
    );
  `)

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_created
    ON discord_queue(session_id, created_at);
  `)

  return db
}
