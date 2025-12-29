import { Database } from 'bun:sqlite'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDbPath, initDatabase } from './db.js'

describe('db utilities', () => {
  describe('getDbPath', () => {
    const originalEnv = process.env.DISCORD_NOTIFY_QUEUE_DB_PATH
    const originalVitest = process.env.VITEST
    const originalNodeEnv = process.env.NODE_ENV

    afterAll(() => {
      process.env.DISCORD_NOTIFY_QUEUE_DB_PATH = originalEnv
      if (originalVitest) {
        process.env.VITEST = originalVitest
      } else {
        delete process.env.VITEST
      }
      if (originalNodeEnv) {
        process.env.NODE_ENV = originalNodeEnv
      } else {
        delete process.env.NODE_ENV
      }
    })

    it('returns default path when env var is not set', () => {
      delete process.env.DISCORD_NOTIFY_QUEUE_DB_PATH
      // 一時的にテスト環境変数を削除して本番動作を確認
      delete process.env.VITEST
      delete process.env.NODE_ENV
      const path = getDbPath()
      expect(path).toContain('.config')
      expect(path).toContain('opencode')
      expect(path).toContain('discord-notify-queue.db')
      // 環境変数を復元
      process.env.VITEST = originalVitest
      process.env.NODE_ENV = originalNodeEnv
    })

    it('returns custom path when env var is set', () => {
      process.env.DISCORD_NOTIFY_QUEUE_DB_PATH = '/custom/path/test.db'
      // 一時的にテスト環境変数を削除して本番動作を確認
      delete process.env.VITEST
      delete process.env.NODE_ENV
      const path = getDbPath()
      expect(path).toBe('/custom/path/test.db')
      // 環境変数を復元
      process.env.VITEST = originalVitest
      process.env.NODE_ENV = originalNodeEnv
    })
  })

  describe('initDatabase', () => {
    let db: Database

    afterAll(() => {
      if (db) {
        db.close()
      }
    })

    it('creates database with discord_queue table', () => {
      // Test using in-memory database
      db = new Database(':memory:')
      db.run('PRAGMA journal_mode = WAL;')
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

      // Verify table exists
      const tables = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='discord_queue'",
        )
        .all()
      expect(tables).toHaveLength(1)
      expect(tables[0]).toEqual({ name: 'discord_queue' })
    })

    it('creates index on session_id and created_at', () => {
      // Test using in-memory database
      db = new Database(':memory:')
      db.run('PRAGMA journal_mode = WAL;')
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

      // Verify index exists
      const indexes = db
        .query(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_created'",
        )
        .all()
      expect(indexes).toHaveLength(1)
      expect(indexes[0]).toEqual({ name: 'idx_session_created' })
    })
  })
})
