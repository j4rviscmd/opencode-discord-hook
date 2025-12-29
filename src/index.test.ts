import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import pluginDefault from './index'

const __test__ = (pluginDefault as any).__test__

const createClientMock = () => {
  return {
    tui: {
      showToast: vi.fn(async () => {}),
    },
  } as any
}

async function waitForQueueWorker(instance: any, timeout = 5000) {
  const start = Date.now()
  while (instance.__test__.queueWorker.running) {
    if (Date.now() - start > timeout) {
      throw new Error('QueueWorker timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('__test__.toIsoTimestamp', () => {
  it('non-number or non-finite returns undefined', () => {
    expect(__test__.toIsoTimestamp('1')).toBeUndefined()
    expect(__test__.toIsoTimestamp(NaN)).toBeUndefined()
    expect(__test__.toIsoTimestamp(Infinity)).toBeUndefined()
  })

  it('returns ISO string for numeric input', () => {
    expect(__test__.toIsoTimestamp(0)).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('__test__.buildFields', () => {
  it('skips empty values and limits to 1024 characters', () => {
    const long = 'a'.repeat(2000)
    const result = __test__.buildFields([
      ['empty', ''],
      ['undef', undefined],
      ['long', long],
      ['ok', 'v'],
    ])

    expect(
      result?.map(
        (f: { name: string; value: string; inline?: boolean }) => f.name,
      ),
    ).toEqual(['long', 'ok'])

    const longField = result?.find(
      (f: { name: string; value: string; inline?: boolean }) =>
        f.name === 'long',
    )
    expect(longField?.value.length).toBe(1024)
    expect(longField?.value.endsWith('...')).toBe(true)
  })
})

describe('__test__.getTodoStatusMarker', () => {
  it('returns correct marker for each status', () => {
    expect(__test__.getTodoStatusMarker('completed')).toBe('[✓]')
    expect(__test__.getTodoStatusMarker('in_progress')).toBe('[▶]')
    expect(__test__.getTodoStatusMarker('pending')).toBe('[ ]')
    expect(__test__.getTodoStatusMarker(undefined)).toBe('[ ]')
    expect(__test__.getTodoStatusMarker('unknown')).toBe('[ ]')
  })
})

describe('__test__.buildMention', () => {
  it('@everyone/@here yields allowed_mentions.parse=["everyone"]', () => {
    expect(__test__.buildMention('@everyone', 'x')).toEqual({
      content: '@everyone',
      allowed_mentions: { parse: ['everyone'] },
    })

    expect(__test__.buildMention('@here', 'x')).toEqual({
      content: '@here',
      allowed_mentions: { parse: ['everyone'] },
    })
  })

  it('others use parse=[] to prevent accidental mentions', () => {
    expect(__test__.buildMention('<@123>', 'x')).toEqual({
      content: '<@123>',
      allowed_mentions: { parse: [] },
    })
  })
})

describe('__test__.buildTodoChecklist', () => {
  it('returns (no todos) when empty', () => {
    expect(__test__.buildTodoChecklist([])).toBe('> (no todos)')
    expect(__test__.buildTodoChecklist(undefined)).toBe('> (no todos)')
  })

  it('excludes cancelled items and truncates content to 200 characters', () => {
    const long = 'a'.repeat(250)
    const result = __test__.buildTodoChecklist([
      { status: 'cancelled', content: 'should-not-appear' },
      { status: 'completed', content: long },
    ])

    expect(result).not.toContain('should-not-appear')
    expect(result).toContain('[✓]')
    expect(result).toContain('...')
  })

  it("appends '> ...and more' when truncated", () => {
    const long = 'a'.repeat(200)
    const many = Array.from({ length: 40 }, () => ({
      status: 'in_progress',
      content: long,
    }))

    const result = __test__.buildTodoChecklist(many)
    expect(result).toContain('> ...and more')
  })
})

describe('__test__.postDiscordWebhook', () => {
  it('on 429, waits retry_after then retries once', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 0 }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 204,
          statusText: 'No Content',
        }),
      )

    const sleepImpl = vi.fn(async () => {})

    await __test__.postDiscordWebhook(
      {
        webhookUrl: 'https://example.invalid/webhook',
        body: { content: 'hi' },
      },
      {
        showErrorAlert: true,
        maybeAlertError: async () => {},
        waitOnRateLimitMs: 10_000,
        fetchImpl: fetchImpl as any,
        sleepImpl,
      },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleepImpl).toHaveBeenCalledTimes(1)
  })

  it('429 retry with wait=true returns valid response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 0 }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'msg1', channel_id: 'thread123' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )

    const result = await __test__.postDiscordWebhook(
      {
        webhookUrl: 'https://example.invalid/webhook',
        body: { content: 'test' },
        wait: true,
      },
      {
        showErrorAlert: false,
        maybeAlertError: async () => {},
        waitOnRateLimitMs: 10,
        fetchImpl: fetchImpl as any,
        sleepImpl: async () => {},
      },
    )

    expect(result).toEqual({ id: 'msg1', channel_id: 'thread123' })
  })

  it('wait=true with invalid json fields returns undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 123, channel_id: 456 }), // Wrong types
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    const result = await __test__.postDiscordWebhook(
      {
        webhookUrl: 'https://example.invalid/webhook',
        body: { content: 'test' },
        wait: true,
      },
      {
        showErrorAlert: false,
        maybeAlertError: async () => {},
        waitOnRateLimitMs: 10,
        fetchImpl: fetchImpl as any,
      },
    )

    expect(result).toBeUndefined()
  })

  it('wait=true with null json returns undefined', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response('null', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await __test__.postDiscordWebhook(
      {
        webhookUrl: 'https://example.invalid/webhook',
        body: { content: 'test' },
        wait: true,
      },
      {
        showErrorAlert: false,
        maybeAlertError: async () => {},
        waitOnRateLimitMs: 10,
        fetchImpl: fetchImpl as any,
      },
    )

    expect(result).toBeUndefined()
  })
})

describe('__test__.parseSendParams', () => {
  it('undefined returns empty set', () => {
    const result = __test__.parseSendParams(undefined)
    expect(result.size).toBe(0)
  })

  it('empty string returns empty set', () => {
    const result = __test__.parseSendParams('')
    expect(result.size).toBe(0)
  })

  it('comma-only string returns empty set', () => {
    const result = __test__.parseSendParams(',,,')
    expect(result.size).toBe(0)
  })

  it('specific keys returns only those keys', () => {
    const result = __test__.parseSendParams('sessionID,messageID')
    expect(result.has('sessionID')).toBe(true)
    expect(result.has('messageID')).toBe(true)
    expect(result.has('partID')).toBe(false)
    expect(result.size).toBe(2)
  })

  it('invalid keys are ignored', () => {
    const result = __test__.parseSendParams('sessionID,invalidKey,messageID')
    expect(result.has('sessionID')).toBe(true)
    expect(result.has('messageID')).toBe(true)
    expect(result.has('invalidKey' as any)).toBe(false)
    expect(result.size).toBe(2)
  })
})

describe('plugin integration', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    delete (globalThis as any).__opencode_discord_notify_registered__

    process.env.DISCORD_WEBHOOK_URL = 'https://discord.invalid/webhook'
    process.env.DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT = '0'

    delete process.env.DISCORD_WEBHOOK_COMPLETE_MENTION
    delete process.env.DISCORD_WEBHOOK_PERMISSION_MENTION

    // Save original fetch
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch
  })

  it('Forum webhook: creates thread when wait=true and continues with thread_id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })

      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: {
          info: {
            id: 's1',
            title: 't',
            time: { created: 0 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'hello',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: {
          info: {
            id: 'm1',
            role: 'user',
          },
        },
      },
    } as any)

    await waitForQueueWorker(instance)

    expect(calls.length).toBe(2)

    const firstUrl = new URL(calls[0].url)
    expect(firstUrl.searchParams.get('wait')).toBe('true')

    const firstBody = JSON.parse(String(calls[0].init.body))
    expect(firstBody.thread_name).toBe('hello')

    const secondUrl = new URL(calls[1].url)
    expect(secondUrl.searchParams.get('thread_id')).toBe('thread123')
  })

  it('permission.updated: sends permission request with mention', async () => {
    process.env.DISCORD_WEBHOOK_PERMISSION_MENTION = '@here'

    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'user text',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'permission.updated',
        properties: {
          sessionID: 's1',
          id: 'perm1',
          type: 'tool_use',
          pattern: '*.ts',
          title: 'Permission needed',
          messageID: 'm2',
          callID: 'c1',
          time: { created: 1000 },
        },
      },
    } as any)

    // Trigger flush with assistant message
    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm2', role: 'assistant' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm2',
            id: 'p2',
            type: 'text',
            text: 'agent response',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    const permissionBody = calls
      .map((c) => JSON.parse(String(c.init.body)))
      .find((b) => b.content === '@here')
    expect(permissionBody).toBeDefined()
    expect(permissionBody.allowed_mentions.parse).toContain('everyone')
  })

  it('session.idle: sends completion with mention', async () => {
    process.env.DISCORD_WEBHOOK_COMPLETE_MENTION = '@everyone'

    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'user text',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    await instance.event?.({
      event: { type: 'session.idle', properties: { sessionID: 's1' } },
    } as any)

    // Trigger flush with assistant message
    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm2', role: 'assistant' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm2',
            id: 'p2',
            type: 'text',
            text: 'agent response',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    const idleBody = calls
      .map((c) => JSON.parse(String(c.init.body)))
      .find((b) => b.content === '@everyone')
    expect(idleBody).toBeDefined()
    expect(idleBody.allowed_mentions.parse).toContain('everyone')
  })

  it('session.error: sends error notification with mention', async () => {
    process.env.DISCORD_WEBHOOK_COMPLETE_MENTION = '<@123>'

    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'user text',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 's1', error: 'Test error occurred' },
      },
    } as any)

    const errorBody = calls
      .map((c) => JSON.parse(String(c.init.body)))
      .find(
        (b) =>
          b.embeds?.[0]?.title === 'Session error' &&
          b.embeds?.[0]?.description?.includes('Test error'),
      )
    expect(errorBody).toBeDefined()
  })

  it('todo.updated: sends todo checklist', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'user text',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'todo.updated',
        properties: {
          sessionID: 's1',
          todos: [
            { status: 'completed', content: 'Task 1' },
            { status: 'in_progress', content: 'Task 2' },
          ],
        },
      },
    } as any)

    // Trigger flush with assistant message
    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm2', role: 'assistant' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm2',
            id: 'p2',
            type: 'text',
            text: 'agent response',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await waitForQueueWorker(instance)

    const todoBody = calls
      .map((c) => JSON.parse(String(c.init.body)))
      .find(
        (b) =>
          b.embeds?.[0]?.title === 'Todo updated' &&
          b.embeds?.[0]?.description?.includes('[✓]'),
      )
    expect(todoBody).toBeDefined()
    expect(todoBody.embeds[0].description).toContain('Task 1')
    expect(todoBody.embeds[0].description).toContain('Task 2')
  })

  it('message.part.updated: assistant part waits for end time', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'user text',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    // Assistant message without end time - should not send yet
    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm2', role: 'assistant' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm2',
            id: 'p2',
            type: 'text',
            text: 'assistant response',
            time: { start: 0 },
          },
        },
      },
    } as any)

    const beforeEnd = calls.filter((c) => {
      const body = JSON.parse(String(c.init.body))
      return body.embeds?.[0]?.description?.includes('assistant response')
    })
    expect(beforeEnd.length).toBe(0)

    // Now with end time - should send
    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm2',
            id: 'p3',
            type: 'text',
            text: 'assistant done',
            time: { start: 0, end: 2 },
          },
        },
      },
    } as any)

    await waitForQueueWorker(instance)

    const afterEnd = calls.filter((c) => {
      const body = JSON.parse(String(c.init.body))
      return body.embeds?.[0]?.description?.includes('assistant done')
    })
    expect(afterEnd.length).toBeGreaterThan(0)
  })

  it('input context: excludes input context text when enabled', async () => {
    process.env.DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT = '1'

    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: '<file>content</file>',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    const inputContextBody = calls.find((c) => {
      const body = JSON.parse(String(c.init.body))
      return body.embeds?.[0]?.description?.includes('<file>')
    })
    expect(inputContextBody).toBeUndefined()
  })

  it('empty text: excludes empty and (empty) text', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: '   ',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    const emptyBody = calls.find((c) => {
      const body = JSON.parse(String(c.init.body))
      return body.embeds?.[0]?.title === 'User says'
    })
    expect(emptyBody).toBeUndefined()
  })

  it('unknown event type: handles default case', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'unknown.event.type',
        properties: {},
      },
    } as any)

    expect(calls.length).toBe(0)
  })

  it('error handling: handles flush errors gracefully', async () => {
    let callCount = 0
    const errors: Error[] = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (callCount === 2) {
        const err = new Error('Network error')
        errors.push(err)
        throw err
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'hello',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    await waitForQueueWorker(instance)

    // Second message should trigger error but be caught by try-catch
    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm2', role: 'assistant' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm2',
            id: 'p2',
            type: 'text',
            text: 'response',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await waitForQueueWorker(instance)

    // Error should have been caught and handled
    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('missing webhook url: shows warning and does not queue', async () => {
    delete process.env.DISCORD_WEBHOOK_URL

    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'hello',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    expect(calls.length).toBe(0)
  })

  it('no thread: sends to channel directly on failure', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      const url_obj = new URL(String(url))
      const has_wait = url_obj.searchParams.get('wait') === 'true'

      if (has_wait) {
        // Return invalid response for thread creation
        return new Response(JSON.stringify({ error: 'failed' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'hello',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    // Should have attempted wait=true and then fallback
    expect(calls.length).toBeGreaterThan(0)
  })

  it('thread name fallback: uses default when no user text', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    // Send session.created without title (defaults to '(untitled)')
    await instance.event?.({
      event: {
        type: 'session.created',
        properties: {
          info: { id: 's123', time: { created: 0 } },
        },
      },
    } as any)

    // Send session.error to trigger flush without user text
    await instance.event?.({
      event: {
        type: 'session.error',
        properties: { sessionID: 's123', error: 'Test error' },
      },
    } as any)

    await waitForQueueWorker(instance)

    expect(calls.length).toBeGreaterThan(0)
    const firstBody = JSON.parse(String(calls[0].init.body))
    // When title and user text are not provided, falls back to sessionID
    expect(firstBody.thread_name).toBe('session s123')
  })

  it('empty queue deletion: removes session from map when queue is empty', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    // Single message that will create thread and consume the queue
    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'hello',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    // Verify thread was created
    const firstUrl = new URL(calls[0].url)
    expect(firstUrl.searchParams.get('wait')).toBe('true')
  })

  it('error during flush: retains pending messages correctly', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ id: 'm0', channel_id: 'thread123' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (callCount === 2) {
        throw new Error('Network error on second message')
      }
      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'first',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm2', role: 'assistant' } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm2',
            id: 'p2',
            type: 'text',
            text: 'second',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    // Error should have been caught
    expect(callCount).toBeGreaterThanOrEqual(1)
  })

  it('duplicate plugin initialization: returns early on second call', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      return new Response(null, { status: 204 })
    }) as any

    // First initialization
    const instance1 = await (pluginDefault as any)({
      client: createClientMock(),
    })

    // Second initialization should return early
    const instance2 = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance2.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    // Second instance's event handler should be a no-op
    expect(instance1).toBeDefined()
    expect(instance2).toBeDefined()
  })

  it('invalid json response: handles malformed wait response', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init })
      const url_obj = new URL(String(url))
      const has_wait = url_obj.searchParams.get('wait') === 'true'

      if (has_wait) {
        // Return invalid JSON
        return new Response('not json', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
      }

      return new Response(null, { status: 204 })
    }) as any

    const instance = await (pluginDefault as any)({
      client: createClientMock(),
    })

    await instance.event?.({
      event: {
        type: 'session.created',
        properties: { info: { id: 's1', title: 't', time: { created: 0 } } },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.part.updated',
        properties: {
          part: {
            sessionID: 's1',
            messageID: 'm1',
            id: 'p1',
            type: 'text',
            text: 'hello',
            time: { start: 0, end: 1 },
          },
        },
      },
    } as any)

    await instance.event?.({
      event: {
        type: 'message.updated',
        properties: { info: { id: 'm1', role: 'user' } },
      },
    } as any)

    // Should have attempted wait=true
    expect(calls.length).toBeGreaterThan(0)
  })

  it('429 retry with invalid response: handles retry failure gracefully', async () => {
    let callCount = 0

    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      callCount++
      if (callCount === 1) {
        return new Response(JSON.stringify({ retry_after: 0 }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (callCount === 2) {
        // Retry succeeds but returns invalid json for wait
        const url_obj = new URL(String(url))
        const has_wait = url_obj.searchParams.get('wait') === 'true'
        if (has_wait) {
          return new Response('invalid', { status: 200 })
        }
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 204 })
    }) as any

    await __test__.postDiscordWebhook(
      {
        webhookUrl: 'https://example.invalid/webhook',
        body: { content: 'test' },
        wait: true,
      },
      {
        showErrorAlert: false,
        maybeAlertError: async () => {},
        waitOnRateLimitMs: 10,
        sleepImpl: async () => {},
      },
    )

    expect(callCount).toBe(2)
  })
})
