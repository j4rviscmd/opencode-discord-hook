import type { Plugin } from '@opencode-ai/plugin'

type DiscordWebhookMessageResponse = {
  id: string
  channel_id: string
}

type DiscordEmbed = {
  title?: string
  description?: string
  url?: string
  color?: number
  timestamp?: string
  fields?: Array<{ name: string; value: string; inline?: boolean }>
}

type DiscordAllowedMentions = {
  parse?: Array<'everyone' | 'roles' | 'users'>
  roles?: string[]
  users?: string[]
}

type DiscordExecuteWebhookBody = {
  content?: string
  username?: string
  avatar_url?: string
  thread_name?: string
  embeds?: DiscordEmbed[]
  allowed_mentions?: DiscordAllowedMentions
}

type SessionSummary = {
  additions: number
  deletions: number
  files: number
}

type SessionSnapshot = {
  title?: string
  shareUrl?: string
  summary?: SessionSummary
}

const COLORS = {
  info: 0x5865f2,
  success: 0x57f287,
  warning: 0xfee75c,
  error: 0xed4245,
} as const

function safeString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toIsoTimestamp(ms: unknown): string | undefined {
  if (typeof ms !== 'number') return undefined
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString()
}

function buildFields(
  fields: Array<[string, unknown]>,
  inline = false,
): DiscordEmbed['fields'] {
  const result: NonNullable<DiscordEmbed['fields']> = []
  for (const [name, rawValue] of fields) {
    const value = safeString(rawValue)
    if (!value) continue
    result.push({
      name,
      value: value.length > 1024 ? value.slice(0, 1021) + '...' : value,
      inline,
    })
  }
  return result.length ? result : undefined
}

function getEnv(name: string): string | undefined {
  try {
    // Bun and Node
    // eslint-disable-next-line no-undef
    return process.env[name]
  } catch {
    return undefined
  }
}

function withQuery(
  url: string,
  params: Record<string, string | undefined>,
): string {
  const u = new URL(url)
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue
    u.searchParams.set(k, v)
  }
  return u.toString()
}

async function postDiscordWebhook(input: {
  webhookUrl: string
  threadId?: string
  wait?: boolean
  body: DiscordExecuteWebhookBody
}): Promise<DiscordWebhookMessageResponse | undefined> {
  const { webhookUrl, threadId, wait, body } = input

  const url = withQuery(webhookUrl, {
    thread_id: threadId,
    wait: wait ? 'true' : undefined,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Discord webhook failed: ${response.status} ${response.statusText} ${text}`,
    )
  }

  if (!wait) return undefined
  const json = (await response.json().catch(() => undefined)) as unknown
  if (!json || typeof json !== 'object') return undefined

  const channelId = (json as any).channel_id
  const messageId = (json as any).id
  if (typeof channelId !== 'string' || typeof messageId !== 'string')
    return undefined

  return {
    id: messageId,
    channel_id: channelId,
  }
}

function isSameSummary(a?: SessionSummary, b?: SessionSummary): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.files === b.files
  )
}

function isImportantSessionUpdate(
  prev?: SessionSnapshot,
  next?: SessionSnapshot,
): {
  changed: boolean
  changedKeys: Array<'title' | 'shareUrl' | 'summary'>
} {
  const changedKeys: Array<'title' | 'shareUrl' | 'summary'> = []

  if ((prev?.title ?? '') !== (next?.title ?? '')) changedKeys.push('title')
  if ((prev?.shareUrl ?? '') !== (next?.shareUrl ?? ''))
    changedKeys.push('shareUrl')
  if (!isSameSummary(prev?.summary, next?.summary)) changedKeys.push('summary')

  return { changed: changedKeys.length > 0, changedKeys }
}

export const DiscordNotificationPlugin: Plugin = async () => {
  const webhookUrl = getEnv('DISCORD_WEBHOOK_URL')
  const username = getEnv('DISCORD_WEBHOOK_USERNAME')
  const avatarUrl = getEnv('DISCORD_WEBHOOK_AVATAR_URL')
  const completeMentionRaw = (
    getEnv('DISCORD_WEBHOOK_COMPLETE_MENTION') ?? ''
  ).trim()
  const completeMention = completeMentionRaw || undefined

  const sessionToThread = new Map<string, string>()
  const threadCreateInFlight = new Map<string, Promise<string | undefined>>()
  const pendingPostsBySession = new Map<string, DiscordExecuteWebhookBody[]>()
  const firstUserTextBySession = new Map<string, string>()
  const pendingTextPartsByMessageId = new Map<string, any[]>()
  const sessionSerial = new Map<string, Promise<void>>()

  const lastSessionInfo = new Map<string, SessionSnapshot>()
  const lastPartSnapshotById = new Map<string, string>()
  const messageRoleById = new Map<string, 'user' | 'assistant'>()

  function normalizeThreadTitle(value: unknown): string {
    return safeString(value).replace(/\s+/g, ' ').trim()
  }

  function buildThreadName(sessionID: string): string {
    const fromUser = normalizeThreadTitle(firstUserTextBySession.get(sessionID))
    if (fromUser) return fromUser.slice(0, 100)

    const fromSessionTitle = normalizeThreadTitle(
      lastSessionInfo.get(sessionID)?.title,
    )
    if (fromSessionTitle) return fromSessionTitle.slice(0, 100)

    const fromSessionId = normalizeThreadTitle(
      sessionID ? `session ${sessionID}` : '',
    )
    if (fromSessionId) return fromSessionId.slice(0, 100)

    return 'untitled'
  }

  async function sendToChannel(body: DiscordExecuteWebhookBody) {
    if (!webhookUrl) return
    await postDiscordWebhook({
      webhookUrl,
      body: {
        ...body,
        username,
        avatar_url: avatarUrl,
      },
    })
  }

  function enqueueToThread(sessionID: string, body: DiscordExecuteWebhookBody) {
    const queue = pendingPostsBySession.get(sessionID) ?? []
    queue.push(body)
    pendingPostsBySession.set(sessionID, queue)
  }

  function enqueueSerial(
    sessionID: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const prev = sessionSerial.get(sessionID) ?? Promise.resolve()
    const next = prev.then(task, task)
    sessionSerial.set(sessionID, next)

    next.finally(() => {
      if (sessionSerial.get(sessionID) === next) sessionSerial.delete(sessionID)
    })

    return next
  }

  async function ensureThread(sessionID: string): Promise<string | undefined> {
    if (!webhookUrl) return undefined

    const existingThreadId = sessionToThread.get(sessionID)
    if (existingThreadId) return existingThreadId

    const inflight = threadCreateInFlight.get(sessionID)
    if (inflight) return await inflight

    const create = (async () => {
      const queue = pendingPostsBySession.get(sessionID) ?? []
      const first = queue.shift()

      if (queue.length) pendingPostsBySession.set(sessionID, queue)
      else pendingPostsBySession.delete(sessionID)

      if (!first) return undefined

      const threadName = buildThreadName(sessionID)

      try {
        const res = await postDiscordWebhook({
          webhookUrl,
          wait: true,
          body: {
            ...first,
            thread_name: threadName,
            username,
            avatar_url: avatarUrl,
          },
        })

        if (res?.channel_id) {
          sessionToThread.set(sessionID, res.channel_id)
          return res.channel_id
        }

        warn(`failed to capture thread_id for session ${sessionID}`)
        return undefined
      } catch (e) {
        // If the webhook is not a forum channel, thread creation may fail.
        // Fall back to posting to the channel to avoid losing notifications.
        await sendToChannel(first)
        return undefined
      } finally {
        threadCreateInFlight.delete(sessionID)
      }
    })()

    threadCreateInFlight.set(sessionID, create)
    return await create
  }

  async function flushPending(sessionID: string): Promise<void> {
    return enqueueSerial(sessionID, async () => {
      if (!webhookUrl) return

      const threadId =
        sessionToThread.get(sessionID) ?? (await ensureThread(sessionID))
      const queue = pendingPostsBySession.get(sessionID)
      if (!queue?.length) return

      try {
        if (threadId) {
          for (const body of queue) {
            await postDiscordWebhook({
              webhookUrl,
              threadId,
              body: {
                ...body,
                username,
                avatar_url: avatarUrl,
              },
            })
          }
        } else {
          for (const body of queue) {
            await sendToChannel(body)
          }
        }
      } finally {
        pendingPostsBySession.delete(sessionID)
      }
    })
  }

  function shouldFlush(sessionID: string): boolean {
    return (
      sessionToThread.has(sessionID) || firstUserTextBySession.has(sessionID)
    )
  }

  function warn(message: string, error?: unknown) {
    // Avoid crashing opencode; keep logs minimal
    if (error) console.warn(`[opencode-discord-hook] ${message}`, error)
    else console.warn(`[opencode-discord-hook] ${message}`)
  }

  function buildCompleteMention():
    | { content?: string; allowed_mentions?: DiscordAllowedMentions }
    | undefined {
    if (!completeMention) return undefined

    if (completeMention === '@everyone' || completeMention === '@here') {
      return {
        content: completeMention,
        allowed_mentions: {
          parse: ['everyone'],
        },
      }
    }

    warn(
      `DISCORD_WEBHOOK_COMPLETE_MENTION is set but unsupported: ${completeMention}. Only @everyone/@here are supported.`,
    )

    // Avoid accidental pings if the value contains role/user mentions.
    return {
      content: completeMention,
      allowed_mentions: {
        parse: [],
      },
    }
  }

  function normalizeTodoContent(value: unknown): string {
    return safeString(value).replace(/\s+/g, ' ').trim()
  }

  function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value
    if (maxLength <= 3) return value.slice(0, maxLength)
    return value.slice(0, maxLength - 3) + '...'
  }

  function setIfChanged(
    map: Map<string, string>,
    key: string,
    next: string,
  ): boolean {
    const prev = map.get(key)
    if (prev === next) return false
    map.set(key, next)
    return true
  }

  function buildTodoChecklist(todos: unknown): string {
    const maxDescription = 4096
    const items = Array.isArray(todos) ? todos : []

    let matchCount = 0
    let description = ''
    let truncated = false

    for (const item of items) {
      const status = (item as any)?.status as string | undefined
      if (status === 'cancelled') continue

      const content = normalizeTodoContent((item as any)?.content)
      if (!content) continue

      const marker =
        status === 'completed'
          ? '[✓]'
          : status === 'in_progress'
            ? '[▶]'
            : '[ ]'
      const line = `> ${marker} ${truncateText(content, 200)}`

      const nextChunk = (description ? '\n' : '') + line
      if (description.length + nextChunk.length > maxDescription) {
        truncated = true
        break
      }

      description += nextChunk
      matchCount += 1
    }

    if (!description) {
      return '> (no todos)'
    }

    if (truncated || matchCount < items.length) {
      const moreLine = `${description ? '\n' : ''}> ...and more`
      if (description.length + moreLine.length <= maxDescription) {
        description += moreLine
      }
    }

    return description
  }

  if (!webhookUrl) {
    warn('DISCORD_WEBHOOK_URL is not set; plugin will be a no-op')
  }

  return {
    event: async ({ event }) => {
      try {
        switch (event.type) {
          case 'session.created': {
            const info = (event.properties as any)?.info
            const sessionID = info?.id as string | undefined
            if (!sessionID) return

            const title = (info?.title as string | undefined) ?? '(untitled)'
            const directory = info?.directory as string | undefined
            const projectID = info?.projectID as string | undefined
            const shareUrl = info?.share?.url as string | undefined
            const createdAt = toIsoTimestamp(info?.time?.created)

            const embed: DiscordEmbed = {
              title: 'Session started',
              description: title,
              url: shareUrl,
              color: COLORS.info,
              timestamp: createdAt,
              fields: buildFields(
                [
                  ['sessionID', sessionID],
                  ['projectID', projectID],
                  ['directory', directory],
                  ['share', shareUrl],
                ],
                false,
              ),
            }

            lastSessionInfo.set(sessionID, { title, shareUrl })
            enqueueToThread(sessionID, { embeds: [embed] })
            if (shouldFlush(sessionID)) await flushPending(sessionID)
            return
          }

          case 'session.updated': {
            const info = (event.properties as any)?.info
            const sessionID = info?.id as string | undefined
            if (!sessionID) return

            const next: SessionSnapshot = {
              title: info?.title as string | undefined,
              shareUrl: info?.share?.url as string | undefined,
              summary: info?.summary
                ? {
                    additions: Number(info.summary.additions) || 0,
                    deletions: Number(info.summary.deletions) || 0,
                    files: Number(info.summary.files) || 0,
                  }
                : undefined,
            }

            const prev = lastSessionInfo.get(sessionID)
            const { changed, changedKeys } = isImportantSessionUpdate(
              prev,
              next,
            )
            lastSessionInfo.set(sessionID, next)
            if (!changed) return

            const fields: Array<[string, unknown]> = [['sessionID', sessionID]]

            if (changedKeys.includes('title')) {
              fields.push(['title', next.title ?? ''])
            }

            if (changedKeys.includes('shareUrl')) {
              fields.push(['share', next.shareUrl ?? ''])
            }

            if (changedKeys.includes('summary') && next.summary) {
              fields.push(['files', next.summary.files])
              fields.push(['additions', next.summary.additions])
              fields.push(['deletions', next.summary.deletions])
            }

            const embed: DiscordEmbed = {
              title: 'Session updated',
              color: COLORS.info,
              fields: buildFields(fields, true),
            }

            enqueueToThread(sessionID, { embeds: [embed] })
            if (shouldFlush(sessionID)) await flushPending(sessionID)
            return
          }

          case 'permission.updated': {
            const p = event.properties as any
            const sessionID = p?.sessionID as string | undefined
            if (!sessionID) return

            const embed: DiscordEmbed = {
              title: 'Permission required',
              description: p?.title as string | undefined,
              color: COLORS.warning,
              timestamp: toIsoTimestamp(p?.time?.created),
              fields: buildFields(
                [
                  ['sessionID', sessionID],
                  ['permissionID', p?.id],
                  ['type', p?.type],
                  ['pattern', p?.pattern],
                  ['messageID', p?.messageID],
                  ['callID', p?.callID],
                ],
                false,
              ),
            }

            enqueueToThread(sessionID, { embeds: [embed] })
            if (shouldFlush(sessionID)) await flushPending(sessionID)
            return
          }

          case 'session.idle': {
            const sessionID = (event.properties as any)?.sessionID as
              | string
              | undefined
            if (!sessionID) return

            const embed: DiscordEmbed = {
              title: 'Session completed',
              color: COLORS.success,
              fields: buildFields([['sessionID', sessionID]], false),
            }

            const mention = buildCompleteMention()

            enqueueToThread(sessionID, {
              content: mention
                ? `${mention.content} Session completed`
                : undefined,
              allowed_mentions: mention?.allowed_mentions,
              embeds: [embed],
            })
            await flushPending(sessionID)
            return
          }

          case 'session.error': {
            const p = event.properties as any
            const sessionID = p?.sessionID as string | undefined

            const errorStr = safeString(p?.error)
            const embed: DiscordEmbed = {
              title: 'Session error',
              color: COLORS.error,
              description: errorStr
                ? errorStr.length > 4096
                  ? errorStr.slice(0, 4093) + '...'
                  : errorStr
                : undefined,
              fields: buildFields([['sessionID', sessionID]], false),
            }

            if (!sessionID) return

            const mention = buildCompleteMention()

            enqueueToThread(sessionID, {
              content: mention ? `${mention.content} Session error` : undefined,
              allowed_mentions: mention?.allowed_mentions,
              embeds: [embed],
            })
            await flushPending(sessionID)
            return
          }

          case 'todo.updated': {
            const p = event.properties as any
            const sessionID = p?.sessionID as string | undefined
            if (!sessionID) return

            const embed: DiscordEmbed = {
              title: 'Todo updated',
              color: COLORS.info,
              fields: buildFields([['sessionID', sessionID]], false),
              description: buildTodoChecklist(p?.todos),
            }

            enqueueToThread(sessionID, { embeds: [embed] })
            if (shouldFlush(sessionID)) await flushPending(sessionID)
            return
          }

          case 'message.updated': {
            const info = (event.properties as any)?.info as any
            const messageID = info?.id as string | undefined
            const role = info?.role as string | undefined
            if (!messageID) return

            // Do not notify on message.updated; keep role tracking for message.part.updated.
            if (role === 'user' || role === 'assistant') {
              messageRoleById.set(messageID, role)

              const pendingParts = pendingTextPartsByMessageId.get(messageID)
              if (pendingParts?.length) {
                pendingTextPartsByMessageId.delete(messageID)

                for (const pendingPart of pendingParts) {
                  const sessionID = pendingPart?.sessionID as string | undefined
                  const partID = pendingPart?.id as string | undefined
                  const type = pendingPart?.type as string | undefined
                  if (!sessionID || !partID || type !== 'text') continue

                  const text = safeString(pendingPart?.text)
                  const snapshot = JSON.stringify({ type, role, text })
                  if (!setIfChanged(lastPartSnapshotById, partID, snapshot))
                    continue

                  if (
                    role === 'user' &&
                    !firstUserTextBySession.has(sessionID)
                  ) {
                    const normalized = normalizeThreadTitle(text)
                    if (normalized)
                      firstUserTextBySession.set(sessionID, normalized)
                  }

                  const embed: DiscordEmbed = {
                    title:
                      role === 'user'
                        ? 'Message part updated: text (user)'
                        : 'Message part updated: text (assistant)',
                    color: COLORS.info,
                    fields: buildFields(
                      [
                        ['sessionID', sessionID],
                        ['messageID', messageID],
                        ['partID', partID],
                        ['role', role],
                      ],
                      false,
                    ),
                    description: truncateText(text || '(empty)', 4096),
                  }

                  enqueueToThread(sessionID, { embeds: [embed] })
                  if (role === 'user') await flushPending(sessionID)
                  else if (shouldFlush(sessionID)) await flushPending(sessionID)
                }
              }
            }

            return
          }

          case 'message.part.updated': {
            const p = event.properties as any
            const part = p?.part as any
            const sessionID = part?.sessionID as string | undefined
            const messageID = part?.messageID as string | undefined
            const partID = part?.id as string | undefined
            const type = part?.type as string | undefined
            if (!sessionID || !messageID || !partID || !type) return

            if (type === 'reasoning') return

            if (type === 'text') {
              const role = messageRoleById.get(messageID)

              if (role !== 'assistant' && role !== 'user') {
                const list = pendingTextPartsByMessageId.get(messageID) ?? []
                list.push(part)
                pendingTextPartsByMessageId.set(messageID, list)
                return
              }

              if (role === 'assistant' && !part?.time?.end) return

              const text = safeString(part?.text)
              const snapshot = JSON.stringify({ type, role, text })
              if (!setIfChanged(lastPartSnapshotById, partID, snapshot)) return

              if (role === 'user' && !firstUserTextBySession.has(sessionID)) {
                const normalized = normalizeThreadTitle(text)
                if (normalized)
                  firstUserTextBySession.set(sessionID, normalized)
              }

              const embed: DiscordEmbed = {
                title:
                  role === 'user'
                    ? 'Message part updated: text (user)'
                    : 'Message part updated: text (assistant)',
                color: COLORS.info,
                fields: buildFields(
                  [
                    ['sessionID', sessionID],
                    ['messageID', messageID],
                    ['partID', partID],
                    ['role', role],
                  ],
                  false,
                ),
                description: truncateText(text || '(empty)', 4096),
              }

              enqueueToThread(sessionID, { embeds: [embed] })

              if (role === 'user') {
                await flushPending(sessionID)
              } else if (shouldFlush(sessionID)) {
                await flushPending(sessionID)
              }

              return
            }

            if (type === 'tool') return

            return
          }

          default:
            return
        }
      } catch (e) {
        warn(`failed handling event ${event.type}`, e)
      }
    },
  }
}
