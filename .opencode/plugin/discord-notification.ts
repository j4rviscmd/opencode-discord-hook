import type { Plugin } from "@opencode-ai/plugin"

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

type DiscordExecuteWebhookBody = {
  content?: string
  username?: string
  avatar_url?: string
  thread_name?: string
  embeds?: DiscordEmbed[]
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
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function toIsoTimestamp(ms: unknown): string | undefined {
  if (typeof ms !== "number") return undefined
  if (!Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString()
}

function buildFields(fields: Array<[string, unknown]>, inline = false): DiscordEmbed["fields"] {
  const result: NonNullable<DiscordEmbed["fields"]> = []
  for (const [name, rawValue] of fields) {
    const value = safeString(rawValue)
    if (!value) continue
    result.push({
      name,
      value: value.length > 1024 ? value.slice(0, 1021) + "..." : value,
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

function withQuery(url: string, params: Record<string, string | undefined>): string {
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
    wait: wait ? "true" : undefined,
  })

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Discord webhook failed: ${response.status} ${response.statusText} ${text}`)
  }

  if (!wait) return undefined
  const json = (await response.json().catch(() => undefined)) as unknown
  if (!json || typeof json !== "object") return undefined

  const channelId = (json as any).channel_id
  const messageId = (json as any).id
  if (typeof channelId !== "string" || typeof messageId !== "string") return undefined

  return {
    id: messageId,
    channel_id: channelId,
  }
}

function isSameSummary(a?: SessionSummary, b?: SessionSummary): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.additions === b.additions && a.deletions === b.deletions && a.files === b.files
}

function isImportantSessionUpdate(prev?: SessionSnapshot, next?: SessionSnapshot): {
  changed: boolean
  changedKeys: Array<"title" | "shareUrl" | "summary">
} {
  const changedKeys: Array<"title" | "shareUrl" | "summary"> = []

  if ((prev?.title ?? "") !== (next?.title ?? "")) changedKeys.push("title")
  if ((prev?.shareUrl ?? "") !== (next?.shareUrl ?? "")) changedKeys.push("shareUrl")
  if (!isSameSummary(prev?.summary, next?.summary)) changedKeys.push("summary")

  return { changed: changedKeys.length > 0, changedKeys }
}

export const DiscordNotificationPlugin: Plugin = async () => {
  const webhookUrl = getEnv("DISCORD_WEBHOOK_URL")
  const username = getEnv("DISCORD_WEBHOOK_USERNAME")
  const avatarUrl = getEnv("DISCORD_WEBHOOK_AVATAR_URL")

  const sessionToThread = new Map<string, string>()
  const lastSessionInfo = new Map<string, SessionSnapshot>()

  function buildThreadName(sessionID: string, title?: string): string {
    const base = (title ?? "").trim() || `session ${sessionID}`
    return `OpenCode: ${base}`.slice(0, 100)
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

  async function sendToThread(sessionID: string, body: DiscordExecuteWebhookBody, opts?: { threadTitle?: string }) {
    if (!webhookUrl) return

    const existingThreadId = sessionToThread.get(sessionID)
    if (existingThreadId) {
      await postDiscordWebhook({
        webhookUrl,
        threadId: existingThreadId,
        body: {
          ...body,
          username,
          avatar_url: avatarUrl,
        },
      })
      return
    }

    const knownTitle = opts?.threadTitle ?? lastSessionInfo.get(sessionID)?.title
    const threadName = buildThreadName(sessionID, knownTitle)

    try {
      const res = await postDiscordWebhook({
        webhookUrl,
        wait: true,
        body: {
          ...body,
          thread_name: threadName,
          username,
          avatar_url: avatarUrl,
        },
      })

      if (res?.channel_id) {
        sessionToThread.set(sessionID, res.channel_id)
      } else {
        warn(`failed to capture thread_id for session ${sessionID}`)
      }
    } catch (e) {
      // If the webhook is not a forum channel, thread creation may fail.
      // Fall back to posting to the channel to avoid losing notifications.
      await sendToChannel(body)
    }
  }

  function warn(message: string, error?: unknown) {
    // Avoid crashing opencode; keep logs minimal
    if (error) console.warn(`[opencode-discord-hook] ${message}`, error)
    else console.warn(`[opencode-discord-hook] ${message}`)
  }

  if (!webhookUrl) {
    warn("DISCORD_WEBHOOK_URL is not set; plugin will be a no-op")
  }

  return {
    event: async ({ event }) => {
      try {
        switch (event.type) {
          case "session.created": {
            const info = (event.properties as any)?.info
            const sessionID = info?.id as string | undefined
            if (!sessionID) return

            const title = (info?.title as string | undefined) ?? "(untitled)"
            const directory = info?.directory as string | undefined
            const projectID = info?.projectID as string | undefined
            const shareUrl = info?.share?.url as string | undefined
            const createdAt = toIsoTimestamp(info?.time?.created)

            const embed: DiscordEmbed = {
              title: "Session started",
              description: title,
              url: shareUrl,
              color: COLORS.info,
              timestamp: createdAt,
              fields: buildFields(
                [
                  ["sessionID", sessionID],
                  ["projectID", projectID],
                  ["directory", directory],
                  ["share", shareUrl],
                ],
                false,
              ),
            }

            lastSessionInfo.set(sessionID, { title, shareUrl })
            await sendToThread(
              sessionID,
              {
                embeds: [embed],
              },
              { threadTitle: title },
            )
            return
          }

          case "session.updated": {
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
            const { changed, changedKeys } = isImportantSessionUpdate(prev, next)
            lastSessionInfo.set(sessionID, next)
            if (!changed) return

            const fields: Array<[string, unknown]> = [["sessionID", sessionID]]

            if (changedKeys.includes("title")) {
              fields.push(["title", next.title ?? ""])
            }

            if (changedKeys.includes("shareUrl")) {
              fields.push(["share", next.shareUrl ?? ""])
            }

            if (changedKeys.includes("summary") && next.summary) {
              fields.push(["files", next.summary.files])
              fields.push(["additions", next.summary.additions])
              fields.push(["deletions", next.summary.deletions])
            }

            const embed: DiscordEmbed = {
              title: "Session updated",
              color: COLORS.info,
              fields: buildFields(fields, true),
            }

            await sendToThread(sessionID, {
              embeds: [embed],
            })
            return
          }

          case "permission.updated": {
            const p = event.properties as any
            const sessionID = p?.sessionID as string | undefined
            if (!sessionID) return

            const embed: DiscordEmbed = {
              title: "Permission required",
              description: p?.title as string | undefined,
              color: COLORS.warning,
              timestamp: toIsoTimestamp(p?.time?.created),
              fields: buildFields(
                [
                  ["sessionID", sessionID],
                  ["permissionID", p?.id],
                  ["type", p?.type],
                  ["pattern", p?.pattern],
                  ["messageID", p?.messageID],
                  ["callID", p?.callID],
                ],
                false,
              ),
            }

            await sendToThread(sessionID, {
              embeds: [embed],
            })
            return
          }

          case "session.idle": {
            const sessionID = (event.properties as any)?.sessionID as string | undefined
            if (!sessionID) return

            const embed: DiscordEmbed = {
              title: "Session completed",
              color: COLORS.success,
              fields: buildFields([["sessionID", sessionID]], false),
            }

            await sendToThread(sessionID, {
              embeds: [embed],
            })
            return
          }

          case "session.error": {
            const p = event.properties as any
            const sessionID = p?.sessionID as string | undefined

            const errorStr = safeString(p?.error)
            const embed: DiscordEmbed = {
              title: "Session error",
              color: COLORS.error,
              description: errorStr ? (errorStr.length > 4096 ? errorStr.slice(0, 4093) + "..." : errorStr) : undefined,
              fields: buildFields([["sessionID", sessionID]], false),
            }

            if (!sessionID) return

            await sendToThread(sessionID, {
              embeds: [embed],
            })
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
