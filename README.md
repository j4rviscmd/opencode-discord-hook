# opencode-discord-notify

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/opencode-discord-notify?logo=npm&logoColor=fff)](https://www.npmjs.com/package/opencode-discord-notify)
[![npm downloads](https://img.shields.io/npm/dm/opencode-discord-notify?logo=npm&logoColor=fff)](https://www.npmjs.com/package/opencode-discord-notify)
[![npm license](https://img.shields.io/npm/l/opencode-discord-notify?logo=npm&logoColor=fff)](https://www.npmjs.com/package/opencode-discord-notify)
![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-4c8bf5)
![Discord Webhook](https://img.shields.io/badge/Discord-Webhook-5865F2?logo=discord&logoColor=fff)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)

English | [日本語](README-JP.md)

<p align="center">
  <img src="assets/image/sample-forum-ch.png" width="700" alt="Discord Forum channel example" />
</p>

A plugin that posts OpenCode events to a Discord webhook.

It is optimized for Discord Forum channel webhooks: it creates one thread per session (via `thread_name`) and posts subsequent updates to the same thread.
It also works with regular text channel webhooks (in that case, it falls back to posting directly to the channel because threads cannot be created).

## What it does

- `session.created`: session started → queues a start notification (thread creation / sending may happen later when required info is available)
- `permission.updated`: permission request → posts a notification
- `session.idle`: session finished → posts a notification
- `session.error`: error → posts a notification (skips if `sessionID` is not present)
- `todo.updated`: todo updates → posts a checklist (keeps received order; excludes `cancelled`)
- `message.updated`: does not notify (tracked for role inference; may emit previously-held `text` later)
- `message.part.updated`: message content/tool results updates →
  - `text`: user text is posted immediately; assistant text is posted only when finalized (when `time.end` exists)
  - `tool`: not posted
  - `reasoning`: not posted

## Setup

### 1) Add the plugin

Add this plugin to your `opencode.json` / `opencode.jsonc` and restart OpenCode.

```jsonc
{
  "plugin": ["opencode-discord-notify@latest"],
}
```

### 2) Create a Discord webhook

- Recommended: create a webhook in a Discord Forum channel.
- A webhook in a regular text channel also works, but thread creation using `thread_name` is a Forum-oriented behavior.

### 3) Environment variables

Required:

- `DISCORD_WEBHOOK_URL`: Discord webhook URL (if not set, the plugin does nothing)

Optional:

- `DISCORD_WEBHOOK_USERNAME`: username for webhook posts
- `DISCORD_WEBHOOK_AVATAR_URL`: avatar URL for webhook posts
- `DISCORD_WEBHOOK_COMPLETE_MENTION`: mention to put in `session.idle` / `session.error` messages (only `@everyone` or `@here` supported; Forum webhooks may not actually ping due to Discord behavior)
- `DISCORD_WEBHOOK_PERMISSION_MENTION`: mention to put in `permission.updated` messages (no fallback to `DISCORD_WEBHOOK_COMPLETE_MENTION`; only `@everyone` or `@here` supported; Forum webhooks may not actually ping due to Discord behavior)
- `DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT`: when set to `1`, exclude "input context" (user `text` parts that start with `<file>`) from notifications (default: `1`; set to `0` to disable)
- `DISCORD_WEBHOOK_SHOW_ERROR_ALERT`: when set to `1`, show an OpenCode TUI toast when Discord webhook requests fail (includes 429). (default: `1`; set to `0` to disable)
- `DISCORD_SEND_PARAMS`: comma-separated list of keys to include as embed fields.
  - **Allowed keys**: `sessionID`, `permissionID`, `type`, `pattern`, `messageID`, `callID`, `partID`, `role`, `directory`, `projectID`
  - **Default behavior** (unset/empty): all fields are disabled (nothing sent)
  - **To send all fields**: list all keys explicitly
  - **Note**: `session.created` always includes `sessionID` regardless
- `DISCORD_WEBHOOK_FALLBACK_URL`: fallback webhook URL for text channel (optional; when set, messages containing `@everyone` or `@here` are automatically sent to this webhook as well; useful because Forum webhooks may not ping mentions due to Discord behavior)

## Notes / behavior

- If `DISCORD_WEBHOOK_URL` is not set, it becomes a no-op.
- If a webhook request fails, it may show an OpenCode TUI toast (controlled by `DISCORD_WEBHOOK_SHOW_ERROR_ALERT`).
- On HTTP 429, it waits `retry_after` seconds if provided (otherwise ~10s) and retries once; if it still fails, it shows a warning toast.
- For Forum thread creation, it appends `?wait=true` and uses `channel_id` in the response as the thread ID.
- `thread_name` priority order (max 100 chars):
  1. first user `text`
  2. session title
  3. `session <sessionID>`
  4. `untitled`
- If thread creation fails (e.g. on non-Forum webhooks), it falls back to posting directly to the channel.
- `permission.updated` / `session.idle` may be queued until the thread name becomes available.
- `session.error` is skipped when `sessionID` is missing in the upstream payload.
- `DISCORD_WEBHOOK_COMPLETE_MENTION=@everyone` (or `@here`) is included as message content, but Forum webhooks may not actually ping (it may just show as plain text).
- `DISCORD_WEBHOOK_PERMISSION_MENTION=@everyone` (or `@here`) is included as message content for `permission.updated`, but Forum webhooks may not actually ping (it may just show as plain text).
- `todo.updated` posts a checklist in the order received (`in_progress` = `[▶]`, `completed` = `[✓]`, `cancelled` excluded). Long lists may be truncated to fit embed constraints (if empty: `(no todos)`; if truncated: adds `...and more`).
- `message.updated` is not posted (tracked for role inference; may post a previously-held text part later).
- `message.part.updated` policy:
  - `text`: user is posted immediately; assistant is posted only when finalized (when `part.time.end` exists)
    - Embed titles are `User says` / `Agent says`
  - `tool`: not posted
  - `reasoning`: not posted (to avoid exposing internal thoughts)
- `DISCORD_SEND_PARAMS` controls embed fields only (it does not affect title/description/content/timestamp). `share` is not an embed field (but Session started uses `shareUrl` as the embed URL).
- When `DISCORD_WEBHOOK_FALLBACK_URL` is set:
  - Messages containing `@everyone` or `@here` (via `DISCORD_WEBHOOK_COMPLETE_MENTION` or `DISCORD_WEBHOOK_PERMISSION_MENTION`) are automatically sent to both the Forum webhook (as a thread post) and the fallback text channel webhook.
  - This ensures reliable notifications while maintaining thread structure in Forums, since Forum webhooks may not ping mentions due to Discord behavior.
  - Fallback messages always include `sessionID` and `thread title` fields, regardless of `DISCORD_SEND_PARAMS` settings, to provide context in the text channel. The `thread title` is the same as the Forum thread name (first user text, or session title if unavailable).
  - Fallback sending is independent of the Forum thread queue and happens immediately.

## Manual test

1. Start OpenCode → a new thread appears in the Forum channel on the first notification timing
2. Trigger a permission request → a notification is posted to the same thread (if the thread isn't created yet, it may be created later)
3. Finish the session → `session.idle` is posted (if you set `DISCORD_WEBHOOK_COMPLETE_MENTION`, it may not actually ping in Forum webhooks)
4. Trigger an error → `session.error` is posted (skipped if no `sessionID`; if you set `DISCORD_WEBHOOK_COMPLETE_MENTION`, it may not actually ping in Forum webhooks)

## Development

- Install deps: `npm i`
- Format: `npx prettier . --write`
- Plugin source: `src/index.ts`

## Roadmap (planned)

- Publish as an npm package (to make install/update easier)
- Support multiple webhooks / multiple channels (route by use case)
- Allow customizing notifications (events, message templates, mention policy)
  - Consider reading a config file (e.g. `opencode-discord-notify.config.json`) and resolving values from env vars as needed
- Improve Discord limitations handling (rate-limit retry, split posts, better truncation rules)
- Improve CI (automate lint/format; add basic tests)

PRs and issues are welcome.
