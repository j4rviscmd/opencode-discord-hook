import { Database } from 'bun:sqlite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PersistentQueue } from './persistent-queue.js'

describe('PersistentQueue', () => {
  let db: Database
  let queue: PersistentQueue

  beforeAll(() => {
    // use in-memory database for testing
    db = new Database(':memory:')

    // Create table
    db.run(`
      CREATE TABLE discord_queue (
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
      CREATE INDEX idx_session_created
      ON discord_queue(session_id, created_at);
    `)

    queue = new PersistentQueue({ db })
  })

  afterEach(() => {
    // Clear all data after each test
    db.run('DELETE FROM discord_queue')
  })

  afterAll(() => {
    db.close()
  })

  describe('enqueue', () => {
    it('inserts message into database', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'test message' },
      })

      const count = queue.count()
      expect(count).toBe(1)
    })

    it('inserts message with thread_id', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: 'thread123',
        webhookBody: { content: 'test message' },
      })

      const messages = queue.dequeue(1)
      expect(messages).toHaveLength(1)
      expect(messages[0].threadId).toBe('thread123')
    })

    it('serializes webhook body as JSON', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: {
          content: 'test',
          embeds: [{ title: 'Test', description: 'Description' }],
        },
      })

      const messages = queue.dequeue(1)
      expect(messages[0].webhookBody).toEqual({
        content: 'test',
        embeds: [{ title: 'Test', description: 'Description' }],
      })
    })
  })

  describe('dequeue', () => {
    it('returns empty array when queue is empty', () => {
      const messages = queue.dequeue(10)
      expect(messages).toEqual([])
    })

    it('returns messages in FIFO order', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'first' },
      })

      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'second' },
      })

      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'third' },
      })

      const messages = queue.dequeue(10)
      expect(messages).toHaveLength(3)
      expect(messages[0].webhookBody.content).toBe('first')
      expect(messages[1].webhookBody.content).toBe('second')
      expect(messages[2].webhookBody.content).toBe('third')
    })

    it('respects limit parameter', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg1' },
      })
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg2' },
      })
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg3' },
      })

      const messages = queue.dequeue(2)
      expect(messages).toHaveLength(2)
      expect(messages[0].webhookBody.content).toBe('msg1')
      expect(messages[1].webhookBody.content).toBe('msg2')
    })

    it('includes all fields in returned messages', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: 'thread123',
        webhookBody: { content: 'test' },
      })

      const messages = queue.dequeue(1)
      expect(messages[0]).toMatchObject({
        id: expect.any(Number),
        sessionId: 'session1',
        threadId: 'thread123',
        webhookBody: { content: 'test' },
        createdAt: expect.any(Number),
        retryCount: 0,
        lastError: null,
      })
    })
  })

  describe('delete', () => {
    it('removes message from database', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'test' },
      })

      const messages = queue.dequeue(1)
      expect(messages).toHaveLength(1)

      queue.delete(messages[0].id!)
      const remaining = queue.dequeue(10)
      expect(remaining).toEqual([])
    })

    it('does not affect other messages', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg1' },
      })
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg2' },
      })

      const messages = queue.dequeue(2)
      queue.delete(messages[0].id!)

      const remaining = queue.dequeue(10)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].webhookBody.content).toBe('msg2')
    })
  })

  describe('updateThreadId', () => {
    it('updates thread_id for matching session_id with NULL thread_id', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg1' },
      })
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg2' },
      })

      queue.updateThreadId('session1', 'thread123')

      const messages = queue.dequeue(10)
      expect(messages).toHaveLength(2)
      expect(messages[0].threadId).toBe('thread123')
      expect(messages[1].threadId).toBe('thread123')
    })

    it('does not update messages with existing thread_id', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: 'existing_thread',
        webhookBody: { content: 'msg1' },
      })
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg2' },
      })

      queue.updateThreadId('session1', 'new_thread')

      const messages = queue.dequeue(10)
      expect(messages[0].threadId).toBe('existing_thread')
      expect(messages[1].threadId).toBe('new_thread')
    })

    it('does not update messages from different sessions', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg1' },
      })
      queue.enqueue({
        sessionId: 'session2',
        threadId: null,
        webhookBody: { content: 'msg2' },
      })

      queue.updateThreadId('session1', 'thread123')

      const messages = queue.dequeue(10)
      expect(messages[0].threadId).toBe('thread123')
      expect(messages[1].threadId).toBeNull()
    })
  })

  describe('count', () => {
    it('returns 0 when queue is empty', () => {
      expect(queue.count()).toBe(0)
    })

    it('returns correct count after enqueue', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg1' },
      })
      expect(queue.count()).toBe(1)

      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg2' },
      })
      expect(queue.count()).toBe(2)
    })

    it('returns correct count after delete', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg1' },
      })
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'msg2' },
      })

      const messages = queue.dequeue(1)
      queue.delete(messages[0].id!)

      expect(queue.count()).toBe(1)
    })
  })

  describe('updateRetryCount', () => {
    it('updates retry_count and last_error for specified message', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'test' },
      })

      const messages = queue.dequeue(1)
      expect(messages[0].retryCount).toBe(0)
      expect(messages[0].lastError).toBeNull()

      queue.updateRetryCount(messages[0].id!, 1, 'Test error message')

      const updated = queue.dequeue(1)
      expect(updated[0].retryCount).toBe(1)
      expect(updated[0].lastError).toBe('Test error message')
    })

    it('increments retry_count on multiple updates', () => {
      queue.enqueue({
        sessionId: 'session1',
        threadId: null,
        webhookBody: { content: 'test' },
      })

      const messages = queue.dequeue(1)
      const id = messages[0].id!

      queue.updateRetryCount(id, 1, 'First error')
      queue.updateRetryCount(id, 2, 'Second error')
      queue.updateRetryCount(id, 3, 'Third error')

      const updated = queue.dequeue(1)
      expect(updated[0].retryCount).toBe(3)
      expect(updated[0].lastError).toBe('Third error')
    })
  })
})
