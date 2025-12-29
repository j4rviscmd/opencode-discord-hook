import type { PersistentQueue } from './persistent-queue.js'
import type { QueueMessage } from './types.js'

const POLL_INTERVAL_MS = 1000 // 1秒
const BATCH_SIZE = 1 // 1件ずつ処理（updateThreadIdの反映を保証）
const MAX_RETRIES = 5 // 最大リトライ回数

export type QueueWorkerDeps = {
  queue: PersistentQueue
  postWebhook: (input: any, deps: any) => Promise<any>
  postDeps: any
  maybeAlertError: (input: any) => Promise<void>
  webhookUrl: string
  username?: string
  avatarUrl?: string
  buildThreadName: (sessionId: string) => string
  onThreadCreated?: (sessionId: string, threadId: string) => void
}

export class QueueWorker {
  private deps: QueueWorkerDeps
  private isRunning = false
  private abortController?: AbortController

  constructor(deps: QueueWorkerDeps) {
    this.deps = deps
  }

  get running(): boolean {
    return this.isRunning
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.abortController = new AbortController()
    await this.poll(this.abortController.signal)
  }

  stop(): void {
    this.abortController?.abort()
    this.isRunning = false
  }

  private async poll(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const messages = this.deps.queue.dequeue(BATCH_SIZE)

      if (messages.length === 0) {
        this.stop()
        return
      }

      for (const message of messages) {
        if (signal.aborted) break
        await this.processMessage(message)
      }

      await this.sleep(POLL_INTERVAL_MS)
    }
  }

  private async processMessage(message: QueueMessage): Promise<void> {
    try {
      // 初回メッセージ: スレッド作成
      if (!message.threadId) {
        const threadName = this.deps.buildThreadName(message.sessionId)
        const res = await this.deps.postWebhook(
          {
            webhookUrl: this.deps.webhookUrl,
            wait: true,
            body: {
              ...message.webhookBody,
              thread_name: threadName,
              username: this.deps.username,
              avatar_url: this.deps.avatarUrl,
            },
          },
          this.deps.postDeps,
        )

        if (res?.channel_id) {
          this.deps.queue.updateThreadId(message.sessionId, res.channel_id)
          message.threadId = res.channel_id
          // コールバックを呼び出してsessionToThreadを更新
          this.deps.onThreadCreated?.(message.sessionId, res.channel_id)
        }

        // スレッド作成時は既にメッセージが送信されているので、DB削除して終了
        this.deps.queue.delete(message.id!)
        return
      }

      // メッセージ送信（threadIdが既に存在する場合のみ）
      await this.deps.postWebhook(
        {
          webhookUrl: this.deps.webhookUrl,
          threadId: message.threadId,
          body: {
            ...message.webhookBody,
            username: this.deps.username,
            avatar_url: this.deps.avatarUrl,
          },
        },
        this.deps.postDeps,
      )

      // 成功: DB削除
      this.deps.queue.delete(message.id!)
    } catch (error: any) {
      // リトライ回数を確認
      const currentRetry = message.retryCount || 0

      if (currentRetry < MAX_RETRIES) {
        // リトライ上限未満: DB保持してリトライ
        this.deps.queue.updateRetryCount(
          message.id!,
          currentRetry + 1,
          error.message || 'Unknown error',
        )

        await this.deps.maybeAlertError({
          key: `discord_queue_retry:${message.id}`,
          title: 'Discord notification retry',
          message: `Failed to send notification. Retry ${currentRetry + 1}/${MAX_RETRIES}. Error: ${error.message}`,
          variant: 'warning',
        })

        // DB削除せず、次回リトライ
        return
      }

      // リトライ上限到達: DB削除
      await this.deps.maybeAlertError({
        key: `discord_queue_error:${message.id}`,
        title: 'Discord notification failed',
        message: `Failed to send notification after ${MAX_RETRIES} retries. Message discarded.`,
        variant: 'error',
      })
      this.deps.queue.delete(message.id!)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
