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

type SessionInfo = {
  title?: string
  shareUrl?: string
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
    // Bun and Node
    // eslint-disable-next-line no-undef
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

  // Avoid accidental pings if the value contains role/user mentions.
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

/*
  Test plan (issue #18 参照; 別ブランチ・別セッションで実装する)：

  - 送信成功（HTTP 200/204相当）でトーストが出ないこと
  - 429（rate limit）で `retry_after` があればそれを優先し、なければ 10 秒待機 → 1 回リトライ →
    - 再度 429 の場合: warning トーストが出ること
    - 200 の場合: トーストが出ないこと
  - 500/403 など 429 以外のエラーで error トーストが出ること
  - `DISCORD_WEBHOOK_SHOW_ERROR_ALERT=0` の場合は、上記のいずれでもトーストが出ないこと
  - `flushPending()` がエラー時にキューを保持し、次回 flush で再送されること

  実装方針（テスト容易性のためのDI）:
  - `postDiscordWebhook(..., deps)` に `fetchImpl` / `sleepImpl` を注入可能にしてある。
  - テストでは `fetchImpl` をモックし、ステータス別レスポンスを返す。
  - `sleepImpl` は即時解決に差し替え、待機時間なしでリトライ経路を走らせる。
*/

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

  const fetchImpl = deps.fetchImpl ?? fetch
  const sleepImpl = deps.sleepImpl ?? sleep

  const fetchImpl = deps.fetchImpl ?? fetch
  const sleepImpl = deps.sleepImpl ?? sleep

  const url = withQuery(webhookUrl, {
    thread_id: threadId,
    wait: wait ? 'true' : undefined,
  })

  const requestInit: RequestInit = {
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

  const handleNonOk = async (response: Response) => {
    const status = response.status
    const statusText = response.statusText

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

    const parseRetryAfterFromHeader = (
      headers: Headers,
    ): number | undefined => {
      const raw = headers.get('Retry-After')
      if (!raw) return undefined

      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) return undefined
      return value
    }

    if (status === 429) {
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
            key: `discord_webhook_error:${status}`,
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

      return retryResponse
    }

    if (deps.showErrorAlert) {
      await deps.maybeAlertError({
        key: `discord_webhook_error:${status}`,
        title: 'Discord webhook error',
        message: `Discord webhook failed: ${status} ${statusText}`,
        variant: 'error',
      })
    }

    const text = await response.text().catch(() => '')
    throw new Error(`Discord webhook failed: ${status} ${statusText} ${text}`)
  }

  const response = await doRequest()
  const finalResponse = response.ok ? response : await handleNonOk(response)
  }

  const doRequest = async () => {
    return await fetchImpl(url, requestInit)
  }

  const handleNonOk = async (response: Response) => {
    const status = response.status
    const statusText = response.statusText

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

    const parseRetryAfterFromHeader = (
      headers: Headers,
    ): number | undefined => {
      const raw = headers.get('Retry-After')
      if (!raw) return undefined

      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) return undefined
      return value
    }

    if (status === 429) {
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
            key: `discord_webhook_error:${status}`,
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

      return retryResponse
    }

    if (deps.showErrorAlert) {
      await deps.maybeAlertError({
        key: `discord_webhook_error:${status}`,
        title: 'Discord webhook error',
        message: `Discord webhook failed: ${status} ${statusText}`,
        variant: 'error',
      })
    }

    const text = await response.text().catch(() => '')
    throw new Error(`Discord webhook failed: ${status} ${statusText} ${text}`)
  }

  const response = await doRequest()
  const finalResponse = response.ok ? response : await handleNonOk(response)

  if (!wait) return undefined

  const json = (await finalResponse.json().catch(() => undefined)) as
    | DiscordWebhookMessageResponse
    | DiscordRateLimitResponse
    | undefined


  const json = (await finalResponse.json().catch(() => undefined)) as
    | DiscordWebhookMessageResponse
    | DiscordRateLimitResponse
    | undefined

  if (!json || typeof json !== 'object') return undefined

  const channelId = (json as any).channel_id
  const messageId = (json as any).id
  if (typeof channelId !== 'string' || typeof messageId !== 'string') {
  if (typeof channelId !== 'string' || typeof messageId !== 'string') {
    return undefined
  }
  }

  return {
    id: messageId,
    channel_id: channelId,
  }
}

const GLOBAL_GUARD_KEY = '__opencode_discord_notify_registered__'

type GlobalThisWithGuard = typeof globalThis & {
  [GLOBAL_GUARD_KEY]?: boolean
}

const plugin: Plugin = async ({ client }) => {
const plugin: Plugin = async ({ client }) => {
  const globalWithGuard = globalThis as GlobalThisWithGuard
  if (globalWithGuard[GLOBAL_GUARD_KEY]) {
    return {
      event: async () => {},
    }
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

  const showErrorAlertRaw = (
    getEnv('DISCORD_WEBHOOK_SHOW_ERROR_ALERT') ?? '1'
  ).trim()
  const showErrorAlert = showErrorAlertRaw !== '0'

  const waitOnRateLimitMs = 10_000
  const toastCooldownMs = 30_000

  const sendParams = parseSendParams(getEnv('SEND_PARAMS'))

  const lastAlertAtByKey = new Map<string, number>()

  const showToast: ShowToast = async ({ title, message, variant }) => {
    try {
      await client.tui.showToast({
        body: {
          title,
          message,
          variant,
          duration: 8000,
        },
      } as any)
    } catch {
      // no-op
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

  const postDeps: PostDiscordWebhookDeps = {
    showErrorAlert,
    maybeAlertError,
    waitOnRateLimitMs,
  }

  const lastAlertAtByKey = new Map<string, number>()

  const showToast: ShowToast = async ({ title, message, variant }) => {
    try {
      await client.tui.showToast({
        body: {
          title,
          message,
          variant,
          duration: 8000,
        },
      } as any)
    } catch {
      // no-op
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

  const postDeps: PostDiscordWebhookDeps = {
    showErrorAlert,
    maybeAlertError,
    waitOnRateLimitMs,
  }

  const sessionToThread = new Map<string, string>()
  const threadCreateInFlight = new Map<string, Promise<string | undefined>>()
  const pendingPostsBySession = new Map<string, DiscordExecuteWebhookBody[]>()
  const firstUserTextBySession = new Map<string, string>()
  const pendingTextPartsByMessageId = new Map<string, any[]>()
  const sessionSerial = new Map<string, Promise<void>>()

  const lastSessionInfo = new Map<string, SessionInfo>()
  const lastPartSnapshotById = new Map<string, string>()
  const messageRoleById = new Map<string, 'user' | 'assistant'>()

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

  async function sendToChannel(body: DiscordExecuteWebhookBody) {
    if (!webhookUrl) return
    await postDiscordWebhook(
      {
        webhookUrl,
        body: {
          ...body,
          username,
          avatar_url: avatarUrl,
        },
      },
      postDeps,
    )
    await postDiscordWebhook(
      {
        webhookUrl,
        body: {
          ...body,
          username,
          avatar_url: avatarUrl,
        },
      },
      postDeps,
    )
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
      const queue = pendingPostsBySession.get(sessionID)
      const first = queue?.[0]
      const queue = pendingPostsBySession.get(sessionID)
      const first = queue?.[0]
      if (!first) return undefined

      const threadName = buildThreadName(sessionID)

      try {
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
        )
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
        )

        if (res?.channel_id) {
          sessionToThread.set(sessionID, res.channel_id)

          const nextQueue = pendingPostsBySession.get(sessionID)
          if (nextQueue?.[0] === first) {
            nextQueue.shift()
            if (nextQueue.length)
              pendingPostsBySession.set(sessionID, nextQueue)
            else pendingPostsBySession.delete(sessionID)
          }


          const nextQueue = pendingPostsBySession.get(sessionID)
          if (nextQueue?.[0] === first) {
            nextQueue.shift()
            if (nextQueue.length)
              pendingPostsBySession.set(sessionID, nextQueue)
            else pendingPostsBySession.delete(sessionID)
          }

          return res.channel_id
        }

        return undefined
      } catch {
        // Forum webhook 以外だと thread 作成が失敗する可能性がある。
        // 通知ロスト回避のため、先頭要素のみチャンネル直投稿にフォールバック。
      } catch {
        // Forum webhook 以外だと thread 作成が失敗する可能性がある。
        // 通知ロスト回避のため、先頭要素のみチャンネル直投稿にフォールバック。
        await sendToChannel(first)

        const nextQueue = pendingPostsBySession.get(sessionID)
        if (nextQueue?.[0] === first) {
          nextQueue.shift()
          if (nextQueue.length) pendingPostsBySession.set(sessionID, nextQueue)
          else pendingPostsBySession.delete(sessionID)
        }


        const nextQueue = pendingPostsBySession.get(sessionID)
        if (nextQueue?.[0] === first) {
          nextQueue.shift()
          if (nextQueue.length) pendingPostsBySession.set(sessionID, nextQueue)
          else pendingPostsBySession.delete(sessionID)
        }

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

      let sentCount = 0
      let sentCount = 0
      try {
        if (threadId) {
          for (const body of queue) {
            await postDiscordWebhook(
              {
                webhookUrl,
                threadId,
                body: {
                  ...body,
                  username,
                  avatar_url: avatarUrl,
                },
              },
              postDeps,
            )
            sentCount += 1
            await postDiscordWebhook(
              {
                webhookUrl,
                threadId,
                body: {
                  ...body,
                  username,
                  avatar_url: avatarUrl,
                },
              },
              postDeps,
            )
            sentCount += 1
          }
        } else {
          for (const body of queue) {
            await sendToChannel(body)
            sentCount += 1
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
      } catch (e) {
        const current = pendingPostsBySession.get(sessionID)
        if (!current?.length) throw e

        const rest = current.slice(sentCount)
        if (rest.length) pendingPostsBySession.set(sessionID, rest)
        else pendingPostsBySession.delete(sessionID)

        throw e
      }
    })
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
                filterSendFields(
                  [
                    ['sessionID', sessionID],
                    ['projectID', projectID],
                    ['directory', directory],
                    ['share', shareUrl],
                  ],
                  withForcedSendParams(sendParams, [
                    'sessionID',
                    'projectID',
                    'directory',
                  ]),
                ),
                false,
              ),
            }

            lastSessionInfo.set(sessionID, { title, shareUrl })
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
                false,
              ),
            }

            const mention = buildPermissionMention()

            enqueueToThread(sessionID, {
              content: mention
                ? `${mention.content} Permission required`
                : undefined,
              allowed_mentions: mention?.allowed_mentions,
              embeds: [embed],
            })
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
              fields: buildFields(
                filterSendFields([['sessionID', sessionID]], sendParams),
                false,
              ),
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
              fields: buildFields(
                filterSendFields([['sessionID', sessionID]], sendParams),
                false,
              ),
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
              fields: buildFields(
                filterSendFields([['sessionID', sessionID]], sendParams),
                false,
              ),
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

                  if (
                    role === 'user' &&
                    excludeInputContext &&
                    isInputContextText(text)
                  ) {
                    const snapshot = JSON.stringify({
                      type,
                      role,
                      skipped: 'input_context',
                    })
                    setIfChanged(lastPartSnapshotById, partID, snapshot)
                    continue
                  }

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

              if (
                role === 'user' &&
                excludeInputContext &&
                isInputContextText(text)
              ) {
                const snapshot = JSON.stringify({
                  type,
                  role,
                  skipped: 'input_context',
                })
                setIfChanged(lastPartSnapshotById, partID, snapshot)
                return
              }

              const snapshot = JSON.stringify({ type, role, text })
              if (!setIfChanged(lastPartSnapshotById, partID, snapshot)) return

              if (role === 'user' && !firstUserTextBySession.has(sessionID)) {
                const normalized = normalizeThreadTitle(text)
                if (normalized)
                  firstUserTextBySession.set(sessionID, normalized)
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
      } catch {
        // no-op
      } catch {
        // no-op
      }
    },
  }
}

export const __test__ = {
  buildMention,
  buildTodoChecklist,
  buildFields,
  toIsoTimestamp,
  postDiscordWebhook,
}

export default plugin
