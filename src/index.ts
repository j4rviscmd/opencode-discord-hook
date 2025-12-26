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

type SendParamKey =
  | 'sessionID'
  | 'permissionID'
  | 'type'
  | 'pattern'
  | 'messageID'
  | 'callID'
  | 'partID'
  | 'role'
  | 'directory'
  | 'projectID'

const SEND_PARAM_KEYS: SendParamKey[] = [
  'sessionID',
  'permissionID',
  'type',
  'pattern',
  'messageID',
  'callID',
  'partID',
  'role',
  'directory',
  'projectID',
]

const SEND_PARAM_KEY_SET = new Set<SendParamKey>(SEND_PARAM_KEYS)

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

function isSendParamKey(value: string): value is SendParamKey {
  return SEND_PARAM_KEY_SET.has(value as SendParamKey)
}

function filterSendFields(
  fields: Array<[string, unknown]>,
  allowed: Set<SendParamKey>,
): Array<[string, unknown]> {
  return fields.filter(([name]) => {
    if (!isSendParamKey(name)) return false
    return allowed.has(name)
  })
}

function getTextPartEmbedTitle(role: 'user' | 'assistant'): string {
  return role === 'user' ? 'User says' : 'Agent says'
}

function withForcedSendParams(
  base: Set<SendParamKey>,
  forced: SendParamKey[],
): Set<SendParamKey> {
  const next = new Set(base)
  for (const key of forced) next.add(key)
  return next
}

function getEnv(name: string): string | undefined {
  try {
    return process.env[name]
  } catch {
    return undefined
  }
}

function parseSendParams(raw: string | undefined): Set<SendParamKey> {
  if (raw === undefined) return new Set(SEND_PARAM_KEYS)

  const tokens = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)

  if (!tokens.length) return new Set(SEND_PARAM_KEYS)

  const result = new Set<SendParamKey>()
  for (const token of tokens) {
    if (!SEND_PARAM_KEY_SET.has(token as SendParamKey)) continue
    result.add(token as SendParamKey)
  }
  return result
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return value.slice(0, maxLength - 3) + '...'
}

function buildMention(
  mention: string | undefined,
  nameForLog: string,
): { content?: string; allowed_mentions?: DiscordAllowedMentions } | undefined {
  void nameForLog

  if (!mention) return undefined

  if (mention === '@everyone' || mention === '@here') {
    return {
      content: mention,
      allowed_mentions: {
        parse: ['everyone'],
      },
    }
  }

  return {
    content: mention,
    allowed_mentions: {
      parse: [],
    },
  }
}

function normalizeTodoContent(value: unknown): string {
  return safeString(value).replace(/\s+/g, ' ').trim()
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
      status === 'completed' ? '[✓]' : status === 'in_progress' ? '[▶]' : '[ ]'
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

type DiscordRateLimitResponse = {
  retry_after?: number
}

type ToastVariant = 'info' | 'success' | 'warning' | 'error'

type ShowToast = (input: {
  title?: string
  message: string
  variant: ToastVariant
}) => Promise<void>

type MaybeAlertError = (input: {
  key: string
  title?: string
  message: string
  variant: ToastVariant
}) => Promise<void>

type PostDiscordWebhookDeps = {
  showErrorAlert: boolean
  maybeAlertError: MaybeAlertError
  waitOnRateLimitMs: number
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}

async function postDiscordWebhook(
  input: {
    webhookUrl: string
    threadId?: string
    wait?: boolean
    body: DiscordExecuteWebhookBody
  },
  deps: PostDiscordWebhookDeps,
): Promise<DiscordWebhookMessageResponse | undefined> {
  const { webhookUrl, threadId, wait, body } = input

  const fetchImpl = deps.fetchImpl ?? (globalThis as any).fetch
  const sleepImpl = deps.sleepImpl ?? sleep

  const url = withQuery(webhookUrl, {
    thread_id: threadId,
    wait: wait ? 'true' : undefined,
  })

  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }

  const doRequest = async () => {
    return await fetchImpl(url, requestInit)
  }

  const parseRetryAfterFromText = (text: string): number | undefined => {
    if (!text) return undefined
    try {
      const json = JSON.parse(text) as DiscordRateLimitResponse
      const value = json?.retry_after
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value
      }
    } catch {
      // ignore
    }
    return undefined
  }

  const parseRetryAfterFromHeader = (headers: Headers): number | undefined => {
    const raw = headers.get('Retry-After')
    if (!raw) return undefined
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return undefined
    return value
  }

  const response = await doRequest()
  if (response.ok) {
    if (!wait) return undefined
    const json = (await response.json().catch(() => undefined)) as
      | DiscordWebhookMessageResponse
      | undefined
    if (!json || typeof json !== 'object') return undefined
    const channelId = (json as any).channel_id
    const messageId = (json as any).id
    if (typeof channelId !== 'string' || typeof messageId !== 'string')
      return undefined
    return { id: messageId, channel_id: channelId }
  }

  // handle non-ok
  if (response.status === 429) {
    const text = await response.text().catch(() => '')
    const retryAfterSeconds =
      parseRetryAfterFromText(text) ??
      parseRetryAfterFromHeader(response.headers)

    const waitMs =
      retryAfterSeconds === undefined
        ? deps.waitOnRateLimitMs
        : Math.ceil(retryAfterSeconds * 1000)

    await sleepImpl(waitMs)
    const retryResponse = await doRequest()

    if (!retryResponse.ok) {
      if (deps.showErrorAlert) {
        await deps.maybeAlertError({
          key: `discord_webhook_error:${retryResponse.status}`,
          title: 'Discord webhook rate-limited',
          message: `Discord webhook returned 429 (rate limited). Waited ${Math.round(
            waitMs / 1000,
          )}s and retried, but it still failed.`,
          variant: 'warning',
        })
      }

      const retryText = await retryResponse.text().catch(() => '')
      throw new Error(
        `Discord webhook failed: ${retryResponse.status} ${retryResponse.statusText} ${retryText}`,
      )
    }

    if (!wait) return undefined
    const json = (await retryResponse.json().catch(() => undefined)) as
      | DiscordWebhookMessageResponse
      | undefined
    if (!json || typeof json !== 'object') return undefined
    const channelId = (json as any).channel_id
    const messageId = (json as any).id
    if (typeof channelId !== 'string' || typeof messageId !== 'string')
      return undefined
    return { id: messageId, channel_id: channelId }
  }

  // other errors
  if (deps.showErrorAlert) {
    await deps.maybeAlertError({
      key: `discord_webhook_error:${response.status}`,
      title: 'Discord webhook error',
      message: `Discord webhook failed: ${response.status} ${response.statusText}`,
      variant: 'error',
    })
  }

  const text = await response.text().catch(() => '')
  throw new Error(
    `Discord webhook failed: ${response.status} ${response.statusText} ${text}`,
  )
}

const GLOBAL_GUARD_KEY = '__opencode_discord_notify_registered__'

type GlobalThisWithGuard = typeof globalThis & {
  [GLOBAL_GUARD_KEY]?: boolean
}

const plugin: Plugin = async ({ client }) => {
  const globalWithGuard = globalThis as GlobalThisWithGuard
  if (globalWithGuard[GLOBAL_GUARD_KEY]) {
    return { event: async () => {} }
  }
  globalWithGuard[GLOBAL_GUARD_KEY] = true

  const webhookUrl = getEnv('DISCORD_WEBHOOK_URL')
  const username = getEnv('DISCORD_WEBHOOK_USERNAME')
  const avatarUrl = getEnv('DISCORD_WEBHOOK_AVATAR_URL')

  const completeMentionRaw = (
    getEnv('DISCORD_WEBHOOK_COMPLETE_MENTION') ?? ''
  ).trim()
  const completeMention = completeMentionRaw || undefined

  const permissionMentionRaw = (
    getEnv('DISCORD_WEBHOOK_PERMISSION_MENTION') ?? ''
  ).trim()
  const permissionMention = permissionMentionRaw || undefined

  const excludeInputContextRaw = (
    getEnv('DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT') ?? '1'
  ).trim()
  const excludeInputContext = excludeInputContextRaw !== '0'

  const showErrorAlertRaw = (
    getEnv('DISCORD_WEBHOOK_SHOW_ERROR_ALERT') ?? '1'
  ).trim()
  const showErrorAlert = showErrorAlertRaw !== '0'

  const waitOnRateLimitMs = 10_000
  const toastCooldownMs = 30_000

  const sendParams = parseSendParams(getEnv('DISCORD_SEND_PARAMS'))

  const lastAlertAtByKey = new Map<string, number>()
  // 既送 partID を保持
  const sentTextPartIds = new Set<string>()

  const showToast: ShowToast = async ({ title, message, variant }) => {
    try {
      await client.tui.showToast({
        body: { title, message, variant, duration: 8000 },
      } as any)
    } catch {
      // noop
    }
  }

  const maybeAlertError: MaybeAlertError = async ({
    key,
    title,
    message,
    variant,
  }) => {
    if (!showErrorAlert) return
    const now = Date.now()
    const last = lastAlertAtByKey.get(key)
    if (last !== undefined && now - last < toastCooldownMs) return
    lastAlertAtByKey.set(key, now)
    await showToast({ title, message, variant })
  }

  const MISSING_URL_KEY = 'discord_webhook_missing_url'
  async function showMissingUrlToastOnce() {
    const now = Date.now()
    const last = lastAlertAtByKey.get(MISSING_URL_KEY)
    if (last !== undefined && now - last < toastCooldownMs) return
    lastAlertAtByKey.set(MISSING_URL_KEY, now)
    await showToast({
      title: 'Discord webhook not configured',
      message:
        'DISCORD_WEBHOOK_URL is not set. Please configure it to enable Discord notifications.',
      variant: 'warning',
    })
  }

  if (!webhookUrl) void showMissingUrlToastOnce()

  const postDeps: PostDiscordWebhookDeps = {
    showErrorAlert,
    maybeAlertError,
    waitOnRateLimitMs,
  }

  const sessionToThread = new Map<string, string>()
  const pendingPostsBySession = new Map<string, DiscordExecuteWebhookBody[]>()
  const firstUserTextBySession = new Map<string, string>()
  const pendingTextPartsByMessageId = new Map<string, any[]>()
  const messageRoleById = new Map<string, 'user' | 'assistant'>()
  const lastSessionInfo = new Map<
    string,
    { title?: string; shareUrl?: string }
  >()

  function normalizeThreadTitle(value: unknown): string {
    return safeString(value).replace(/\s+/g, ' ').trim()
  }

  function isInputContextText(text: string): boolean {
    return text.trimStart().startsWith('<file>')
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

  async function ensureThread(sessionID: string): Promise<string | undefined> {
    if (!webhookUrl) return undefined
    const existing = sessionToThread.get(sessionID)
    if (existing) return existing

    const queue = pendingPostsBySession.get(sessionID)
    const first = queue?.[0]
    if (!first) return undefined

    const threadName = buildThreadName(sessionID)

    const res = await postDiscordWebhook(
      {
        webhookUrl,
        wait: true,
        body: {
          ...first,
          thread_name: threadName,
          username,
          avatar_url: avatarUrl,
        },
      },
      postDeps,
    ).catch(async (e) => {
      // On error, fallback to sending the first item to channel
      await postDiscordWebhook(
        { webhookUrl, body: { ...first, username, avatar_url: avatarUrl } },
        postDeps,
      ).catch(() => {})
      return undefined
    })

    if (res?.channel_id) {
      sessionToThread.set(sessionID, res.channel_id)
      // remove first from queue if it still is head
      const nextQueue = pendingPostsBySession.get(sessionID)
      if (nextQueue?.[0] === first) {
        nextQueue.shift()
        if (nextQueue.length) pendingPostsBySession.set(sessionID, nextQueue)
        else pendingPostsBySession.delete(sessionID)
      }
      return res.channel_id
    }

    return undefined
  }

  function enqueueToThread(sessionID: string, body: DiscordExecuteWebhookBody) {
    if (!webhookUrl) {
      // show a one-time warning to the user (non-blocking) and do not queue
      void showMissingUrlToastOnce()
      return
    }

    const queue = pendingPostsBySession.get(sessionID) ?? []
    queue.push(body)
    pendingPostsBySession.set(sessionID, queue)
  }

  async function flushPending(sessionID: string): Promise<void> {
    if (!webhookUrl) return
    const threadId =
      sessionToThread.get(sessionID) ?? (await ensureThread(sessionID))
    const queue = pendingPostsBySession.get(sessionID)
    if (!queue?.length) return

    let sentCount = 0
    try {
      if (threadId) {
        for (const body of queue) {
          await postDiscordWebhook(
            {
              webhookUrl,
              threadId,
              body: { ...body, username, avatar_url: avatarUrl },
            },
            postDeps,
          )
          sentCount += 1
        }
      } else {
        for (const body of queue) {
          await postDiscordWebhook(
            { webhookUrl, body: { ...body, username, avatar_url: avatarUrl } },
            postDeps,
          )
          sentCount += 1
        }
      }

      pendingPostsBySession.delete(sessionID)
    } catch (e) {
      const current = pendingPostsBySession.get(sessionID)
      if (!current?.length) throw e
      const rest = current.slice(sentCount)
      if (rest.length) pendingPostsBySession.set(sessionID, rest)
      else pendingPostsBySession.delete(sessionID)
      throw e
    }
  }

  function shouldFlush(sessionID: string): boolean {
    return (
      sessionToThread.has(sessionID) || firstUserTextBySession.has(sessionID)
    )
  }

  function buildCompleteMention():
    | { content?: string; allowed_mentions?: DiscordAllowedMentions }
    | undefined {
    return buildMention(completeMention, 'DISCORD_WEBHOOK_COMPLETE_MENTION')
  }

  function buildPermissionMention():
    | { content?: string; allowed_mentions?: DiscordAllowedMentions }
    | undefined {
    return buildMention(permissionMention, 'DISCORD_WEBHOOK_PERMISSION_MENTION')
  }
  /**
   * Discord のメンションをエスケープする
   * @param text
   * @returns
   */
  function escapeDiscordMention(text: string): string {
    return text.replace(/^@/g, '@\u200b')
  }

  async function handleTextPart(input: {
    part: any
    role: 'user' | 'assistant'
    sessionID: string
    messageID: string
    replay?: boolean
  }) {
    const { part, role, sessionID, messageID, replay } = input
    const partID = part?.id as string | undefined
    if (!partID) return
    if (!replay && role === 'assistant' && !part?.time?.end) return

    if (sentTextPartIds.has(partID)) return
    sentTextPartIds.add(partID)

    const text = escapeDiscordMention(safeString(part?.text))

    if (role === 'user' && excludeInputContext && isInputContextText(text)) {
      return
    }
    if ((role === 'user' && text.trim() === '') || text.trim() === '(empty)') {
      return
    }

    if (role === 'user' && !firstUserTextBySession.has(sessionID)) {
      const normalized = normalizeThreadTitle(text)
      if (normalized) firstUserTextBySession.set(sessionID, normalized)
    }

    const embed: DiscordEmbed = {
      title: getTextPartEmbedTitle(role),
      color: COLORS.info,
      fields: buildFields(
        filterSendFields(
          [
            ['sessionID', sessionID],
            ['messageID', messageID],
            ['partID', partID],
            ['role', role],
          ],
          sendParams,
        ),
      ),
      description: truncateText(text || '(empty)', 4096),
    }

    enqueueToThread(sessionID, { embeds: [embed] })

    if (role === 'user') {
      await flushPending(sessionID)
    } else if (shouldFlush(sessionID)) {
      await flushPending(sessionID)
    }
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

  return {
    event: async ({ event }) => {
      try {
        switch (event.type) {
          case 'session.created': {
            const info = (event.properties as any)?.info
            const sessionID = info?.id as string | undefined
            if (!sessionID) return

            const title = (info?.title as string | undefined) ?? '(untitled)'
            const shareUrl = info?.share?.url as string | undefined
            const createdAt = toIsoTimestamp(info?.time?.created)

            const embed: DiscordEmbed = {
              title: 'Session started',
              description: title,
              url: shareUrl,
              color: COLORS.info,
              timestamp: createdAt,
              fields: buildFields(
                filterSendFields(
                  [
                    ['sessionID', sessionID],
                    ['projectID', info?.projectID],
                    ['directory', info?.directory],
                    ['share', shareUrl],
                  ],
                  withForcedSendParams(sendParams, [
                    'sessionID',
                    'projectID',
                    'directory',
                  ]),
                ),
              ),
            }

            lastSessionInfo.set(sessionID, { title, shareUrl })
            enqueueToThread(sessionID, { embeds: [embed] })
            // NOTE:
            // 「状態更新イベント」であり会話の区切りではない。
            // ここで flush すると、assistant 最終発言の flush と競合し
            // Agent says が二重送信されるため、enqueue のみに留める。
            // if (shouldFlush(sessionID)) await flushPending(sessionID)
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
                filterSendFields(
                  [
                    ['sessionID', sessionID],
                    ['permissionID', p?.id],
                    ['type', p?.type],
                    ['pattern', p?.pattern],
                    ['messageID', p?.messageID],
                    ['callID', p?.callID],
                  ],
                  sendParams,
                ),
              ),
            }

            const mention = buildPermissionMention()

            enqueueToThread(sessionID, {
              content: mention ? `${mention.content}` : undefined,
              allowed_mentions: mention?.allowed_mentions,
              embeds: [embed],
            })
            // NOTE:
            // 「状態更新イベント」であり会話の区切りではない。
            // ここで flush すると、assistant 最終発言の flush と競合し
            // Agent says が二重送信されるため、enqueue のみに留める。
            // if (shouldFlush(sessionID)) await flushPending(sessionID)
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
              fields: buildFields(
                filterSendFields(
                  [['sessionID', sessionID]],
                  withForcedSendParams(sendParams, ['sessionID']),
                ),
              ),
            }

            const mention = buildCompleteMention()
            enqueueToThread(sessionID, {
              content: mention ? `${mention.content}` : undefined,
              allowed_mentions: mention?.allowed_mentions,
              embeds: [embed],
            })
            // NOTE:
            // 「状態更新イベント」であり会話の区切りではない。
            // ここで flush すると、assistant 最終発言の flush と競合し
            // Agent says が二重送信されるため、enqueue のみに留める。
            // await flushPending(sessionID)
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
              fields: buildFields(
                filterSendFields(
                  [['sessionID', sessionID]],
                  withForcedSendParams(sendParams, [
                    'sessionID',
                    'projectID',
                    'directory',
                  ]),
                ),
              ),
            }

            if (!sessionID) return

            const mention = buildCompleteMention()

            enqueueToThread(sessionID, {
              content: mention ? `$Session error` : undefined,
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
              fields: buildFields(
                filterSendFields([['sessionID', sessionID]], sendParams),
              ),
              description: buildTodoChecklist(p?.todos),
            }

            enqueueToThread(sessionID, { embeds: [embed] })
            // NOTE:
            // 「状態更新イベント」であり会話の区切りではない。
            // ここで flush すると、assistant 最終発言の flush と競合し
            // Agent says が二重送信されるため、enqueue のみに留める。
            // if (shouldFlush(sessionID)) await flushPending(sessionID)
            return
          }

          case 'message.updated': {
            const info = (event.properties as any)?.info
            const messageID = info?.id as string | undefined
            const role = info?.role as string | undefined
            if (!messageID) return

            if (role !== 'user' && role !== 'assistant') return
            messageRoleById.set(messageID, role)

            const pendingParts = pendingTextPartsByMessageId.get(messageID)
            if (!pendingParts?.length) return

            pendingTextPartsByMessageId.delete(messageID)

            for (const part of pendingParts) {
              const sessionID = part?.sessionID
              const partID = part?.id
              if (!sessionID || !partID || part?.type !== 'text') continue

              await handleTextPart({
                part,
                role,
                sessionID,
                messageID,
                replay: true,
              })
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

            const role = messageRoleById.get(messageID)
            if (role !== 'assistant' && role !== 'user') {
              const list = pendingTextPartsByMessageId.get(messageID) ?? []
              list.push(part)
              pendingTextPartsByMessageId.set(messageID, list)
              return
            }
            await handleTextPart({
              part,
              role,
              sessionID,
              messageID,
            })

            return
          }

          default:
            return
        }
      } catch {
        // noop
      }
    },
  }
}

;(plugin as any).__test__ = {
  buildMention,
  buildTodoChecklist,
  buildFields,
  toIsoTimestamp,
  postDiscordWebhook,
}

export default plugin
