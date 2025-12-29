import type { Database } from 'bun:sqlite'
import type { PersistentQueueDeps, QueueMessage } from './types.js'

export class PersistentQueue {
  private db: Database

  constructor(deps: PersistentQueueDeps) {
    this.db = deps.db
  }

  enqueue(
    message: Omit<
      QueueMessage,
      'id' | 'createdAt' | 'retryCount' | 'lastError'
    >,
  ): void {
    const query = this.db.query(`
      INSERT INTO discord_queue (session_id, thread_id, webhook_body, created_at)
      VALUES (?, ?, ?, ?)
    `)
    query.run(
      message.sessionId,
      message.threadId,
      JSON.stringify(message.webhookBody),
      Date.now(),
    )
  }

  dequeue(limit: number): QueueMessage[] {
    const query = this.db.query(`
      SELECT * FROM discord_queue
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `)
    const rows = query.all(limit) as any[]
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      threadId: row.thread_id,
      webhookBody: JSON.parse(row.webhook_body),
      createdAt: row.created_at,
      retryCount: row.retry_count,
      lastError: row.last_error,
    }))
  }

  delete(id: number): void {
    this.db.query('DELETE FROM discord_queue WHERE id = ?').run(id)
  }

  updateThreadId(sessionId: string, threadId: string): void {
    this.db
      .query(
        `
      UPDATE discord_queue
      SET thread_id = ?
      WHERE session_id = ? AND thread_id IS NULL
    `,
      )
      .run(threadId, sessionId)
  }

  count(): number {
    const result = this.db.query('SELECT COUNT(*) as count FROM discord_queue').get() as any
    return result.count
  }

  updateRetryCount(id: number, retryCount: number, lastError: string): void {
    this.db
      .query(
        `
      UPDATE discord_queue
      SET retry_count = ?, last_error = ?
      WHERE id = ?
    `,
      )
      .run(retryCount, lastError, id)
  }
}
