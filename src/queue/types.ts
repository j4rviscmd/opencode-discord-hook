import type { Database } from 'bun:sqlite'
import type { DiscordExecuteWebhookBody } from '../index.js'

export type QueueMessage = {
  id?: number
  sessionId: string
  threadId: string | null
  webhookBody: DiscordExecuteWebhookBody
  createdAt?: number
  retryCount?: number
  lastError?: string
}

export type PersistentQueueDeps = {
  db: Database
}
