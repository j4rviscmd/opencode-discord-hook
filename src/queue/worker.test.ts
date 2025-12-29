import { describe, expect, it, vi } from 'vitest'
import { QueueWorker } from './worker.js'

describe('QueueWorker', () => {
  describe('start and stop', () => {
    it('starts worker when not running', async () => {
      const mockQueue = {
        dequeue: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        count: vi.fn().mockReturnValue(0),
        enqueue: vi.fn(),
      }

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: vi.fn(),
        postDeps: {},
        maybeAlertError: vi.fn(),
        webhookUrl: 'https://example.com/webhook',
        buildThreadName: vi.fn((sessionId) => `thread-${sessionId}`),
      })

      expect(worker.running).toBe(false)

      await worker.start()

      // 自動停止（DB空）のため、完了後はfalse
      expect(worker.running).toBe(false)
      expect(mockQueue.dequeue).toHaveBeenCalled()
    })

    it('does not start if already running', async () => {
      const mockQueue = {
        dequeue: vi
          .fn()
          .mockReturnValueOnce([
            {
              id: 1,
              sessionId: 'session1',
              threadId: 'thread1',
              webhookBody: {},
            },
          ])
          .mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const mockPostWebhook = vi.fn().mockResolvedValue(undefined)

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: mockPostWebhook,
        postDeps: {},
        maybeAlertError: vi.fn(),
        webhookUrl: 'https://example.com/webhook',
      })

      // 1つ目のstartを開始（バックグラウンドで実行）
      const startPromise1 = worker.start()

      // 少し待ってから2回目のstart（既に実行中なので即座にreturn）
      await new Promise((resolve) => setTimeout(resolve, 50))
      await worker.start()

      await startPromise1

      // postWebhookは1メッセージ分のみ呼ばれる
      expect(mockPostWebhook).toHaveBeenCalledTimes(1)
    })

    it('stops worker when stop() is called', async () => {
      const mockQueue = {
        dequeue: vi
          .fn()
          .mockReturnValueOnce([{ id: 1, webhookBody: {}, threadId: 'thread1', sessionId: 'session1' }])
          .mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const mockPostWebhook = vi.fn().mockResolvedValue(undefined)

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: mockPostWebhook,
        postDeps: {},
        maybeAlertError: vi.fn(),
        webhookUrl: 'https://example.com/webhook',
      })

      const startPromise = worker.start()

      // 少し待ってからstop
      await new Promise((resolve) => setTimeout(resolve, 10))
      worker.stop()

      await startPromise
      expect(worker.running).toBe(false)
    })
  })

  describe('auto-stop when queue is empty', () => {
    it('stops automatically when dequeue returns empty array', async () => {
      const mockQueue = {
        dequeue: vi.fn().mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: vi.fn(),
        postDeps: {},
        maybeAlertError: vi.fn(),
        webhookUrl: 'https://example.com/webhook',
        buildThreadName: vi.fn((sessionId) => `thread-${sessionId}`),
      })

      await worker.start()

      expect(worker.running).toBe(false)
      expect(mockQueue.dequeue).toHaveBeenCalledWith(1) // BATCH_SIZE
    })
  })

  describe('message processing', () => {
    it('sends message and deletes from queue on success', async () => {
      const mockQueue = {
        dequeue: vi
          .fn()
          .mockReturnValueOnce([
            {
              id: 1,
              sessionId: 'session1',
              threadId: 'thread123',
              webhookBody: { content: 'test message' },
            },
          ])
          .mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const mockPostWebhook = vi.fn().mockResolvedValue(undefined)

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: mockPostWebhook,
        postDeps: { test: 'deps' },
        maybeAlertError: vi.fn(),
        webhookUrl: 'https://example.com/webhook',
        username: 'TestBot',
        avatarUrl: 'https://example.com/avatar.png',
      })

      await worker.start()

      expect(mockPostWebhook).toHaveBeenCalledWith(
        {
          webhookUrl: 'https://example.com/webhook',
          threadId: 'thread123',
          body: {
            content: 'test message',
            username: 'TestBot',
            avatar_url: 'https://example.com/avatar.png',
          },
        },
        { test: 'deps' },
      )
      expect(mockQueue.delete).toHaveBeenCalledWith(1)
    })

    it('creates thread for first message with null threadId', async () => {
      const mockQueue = {
        dequeue: vi
          .fn()
          .mockReturnValueOnce([
            {
              id: 1,
              sessionId: 'session1',
              threadId: null,
              webhookBody: { content: 'first message' },
            },
          ])
          .mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const mockPostWebhook = vi
        .fn()
        .mockResolvedValueOnce({ channel_id: 'new_thread_123' }) // スレッド作成

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: mockPostWebhook,
        postDeps: {},
        maybeAlertError: vi.fn(),
        webhookUrl: 'https://example.com/webhook',
        buildThreadName: vi.fn((sessionId) => `thread-${sessionId}`),
      })

      await worker.start()

      // スレッド作成のpostWebhook呼び出し（1回のみ）
      expect(mockPostWebhook).toHaveBeenCalledTimes(1)
      expect(mockPostWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          wait: true,
          body: expect.objectContaining({
            thread_name: 'thread-session1',
          }),
        }),
        {},
      )

      // updateThreadIdが呼ばれる
      expect(mockQueue.updateThreadId).toHaveBeenCalledWith(
        'session1',
        'new_thread_123',
      )

      // スレッド作成時は1回の呼び出しで完了するので、DB削除される
      expect(mockQueue.delete).toHaveBeenCalledWith(1)
    })

    it('retries on error and updates retry_count', async () => {
      const mockQueue = {
        dequeue: vi
          .fn()
          .mockReturnValueOnce([
            {
              id: 1,
              sessionId: 'session1',
              threadId: 'thread123',
              webhookBody: { content: 'test message' },
              retryCount: 0,
            },
          ])
          .mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        updateRetryCount: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const mockPostWebhook = vi
        .fn()
        .mockRejectedValue(new Error('Network error'))

      const mockMaybeAlertError = vi.fn().mockResolvedValue(undefined)

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: mockPostWebhook,
        postDeps: {},
        maybeAlertError: mockMaybeAlertError,
        webhookUrl: 'https://example.com/webhook',
      })

      await worker.start()

      // リトライ上限未満なのでupdateRetryCountが呼ばれる
      expect(mockQueue.updateRetryCount).toHaveBeenCalledWith(
        1,
        1,
        'Network error',
      )

      // 警告通知が表示される
      expect(mockMaybeAlertError).toHaveBeenCalledWith({
        key: 'discord_queue_retry:1',
        title: 'Discord notification retry',
        message:
          'Failed to send notification. Retry 1/5. Error: Network error',
        variant: 'warning',
      })

      // DB削除されない（リトライのため保持）
      expect(mockQueue.delete).not.toHaveBeenCalled()
    })

    it('deletes message after max retries exceeded', async () => {
      const mockQueue = {
        dequeue: vi
          .fn()
          .mockReturnValueOnce([
            {
              id: 1,
              sessionId: 'session1',
              threadId: 'thread123',
              webhookBody: { content: 'test message' },
              retryCount: 5, // 既に5回リトライ済み
            },
          ])
          .mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        updateRetryCount: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const mockPostWebhook = vi
        .fn()
        .mockRejectedValue(new Error('Network error'))

      const mockMaybeAlertError = vi.fn().mockResolvedValue(undefined)

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: mockPostWebhook,
        postDeps: {},
        maybeAlertError: mockMaybeAlertError,
        webhookUrl: 'https://example.com/webhook',
      })

      await worker.start()

      // リトライ上限到達なのでupdateRetryCountは呼ばれない
      expect(mockQueue.updateRetryCount).not.toHaveBeenCalled()

      // エラー通知が表示される
      expect(mockMaybeAlertError).toHaveBeenCalledWith({
        key: 'discord_queue_error:1',
        title: 'Discord notification failed',
        message:
          'Failed to send notification after 5 retries. Message discarded.',
        variant: 'error',
      })

      // DB削除される
      expect(mockQueue.delete).toHaveBeenCalledWith(1)
    })

    it('processes multiple messages in batch', async () => {
      const mockQueue = {
        dequeue: vi
          .fn()
          .mockReturnValueOnce([
            {
              id: 1,
              sessionId: 'session1',
              threadId: 'thread1',
              webhookBody: { content: 'msg1' },
            },
            {
              id: 2,
              sessionId: 'session1',
              threadId: 'thread1',
              webhookBody: { content: 'msg2' },
            },
            {
              id: 3,
              sessionId: 'session1',
              threadId: 'thread1',
              webhookBody: { content: 'msg3' },
            },
          ])
          .mockReturnValue([]),
        delete: vi.fn(),
        updateThreadId: vi.fn(),
        count: vi.fn(),
        enqueue: vi.fn(),
      }

      const mockPostWebhook = vi.fn().mockResolvedValue(undefined)

      const worker = new QueueWorker({
        queue: mockQueue as any,
        postWebhook: mockPostWebhook,
        postDeps: {},
        maybeAlertError: vi.fn(),
        webhookUrl: 'https://example.com/webhook',
      })

      await worker.start()

      expect(mockPostWebhook).toHaveBeenCalledTimes(3)
      expect(mockQueue.delete).toHaveBeenCalledTimes(3)
      expect(mockQueue.delete).toHaveBeenNthCalledWith(1, 1)
      expect(mockQueue.delete).toHaveBeenNthCalledWith(2, 2)
      expect(mockQueue.delete).toHaveBeenNthCalledWith(3, 3)
    })
  })
})
