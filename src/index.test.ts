import { beforeEach, describe, expect, it, vi } from 'vitest'

import pluginDefault, { __test__ } from './index'

const createClientMock = () => {
  return {
    tui: {
      showToast: vi.fn(async () => {}),
    },
  } as any
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

    expect(result?.map((f) => f.name)).toEqual(['long', 'ok'])

    const longField = result?.find((f) => f.name === 'long')
    expect(longField?.value.length).toBe(1024)
    expect(longField?.value.endsWith('...')).toBe(true)
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
})

describe('plugin integration', () => {
  beforeEach(() => {
    delete (globalThis as any).__opencode_discord_notify_registered__

    process.env.DISCORD_WEBHOOK_URL = 'https://discord.invalid/webhook'
    process.env.DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT = '0'

    delete process.env.DISCORD_WEBHOOK_COMPLETE_MENTION
    delete process.env.DISCORD_WEBHOOK_PERMISSION_MENTION
  })

  it('Forum webhook: creates thread when wait=true and continues with thread_id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: any, init: any) => {
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
      }),
    )

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

    expect(calls.length).toBe(2)

    const firstUrl = new URL(calls[0].url)
    expect(firstUrl.searchParams.get('wait')).toBe('true')

    const firstBody = JSON.parse(String(calls[0].init.body))
    expect(firstBody.thread_name).toBe('hello')

    const secondUrl = new URL(calls[1].url)
    expect(secondUrl.searchParams.get('thread_id')).toBe('thread123')
  })
})
