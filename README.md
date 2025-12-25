# opencode-discord-notify

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-4c8bf5)
![Discord Webhook](https://img.shields.io/badge/Discord-Webhook-5865F2?logo=discord&logoColor=fff)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)

English | [日本語](README-JP.md)

<!-- markdownlint-disable -->
<p align="center">
  <img src="assets/image/sample-forum-ch.png" width="700" alt="Discord Forum channel example" />
</p>
<!-- markdownlint-enable -->

A plugin that posts OpenCode events to a Discord webhook.

It is optimized for Discord Forum channel webhooks: it creates one thread per session (via `thread_name`) and posts subsequent updates to the same thread.
It also works with regular text channel webhooks (in that case, it falls back to posting directly to the channel because threads cannot be created).

## Usage

Add this plugin to your `opencode.json` / `opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-discord-notify@latest"],
}
```

If you want to pin a version:

```jsonc
{
  "plugin": ["opencode-discord-notify@0.1.0"],
}
```

## What it does

- `session.created`: session started → queues a start notification (thread creation / sending may happen later when required info is available)
- `permission.updated`: permission request → posts a notification
- `session.idle`: session finished → posts a notification
- `session.error`: error → posts a notification (skips if `sessionID` is not present)
- `todo.updated`: todo updates → posts a checklist (keeps received order; excludes `cancelled`)
- `message.updated`: does not notify (tracked for role inference; may emit previously-held text later)
- `message.part.updated`:
  - `text`: user text is posted immediately; assistant text is posted only when finalized (`time.end`)
  - `tool`: not posted
  - `reasoning`: not posted

## Setup

### 1) Install dependencies

Install the OpenCode plugin runner globally.

- `npm i -g @opencode-ai/plugin`

### 2) Place the plugin file

Put the plugin file in your project:

- `.opencode/plugin/discord-notification.ts`

(If you want to use it globally, place it under `~/.config/opencode/plugin/` instead.)

> [!WARNING]
> If you place the plugin in both the global directory (`~/.config/opencode/plugin/`) and the project directory (`.opencode/plugin/`), it may be loaded twice and send duplicate notifications. Choose either global or project placement, not both.

### 3) Create a Discord webhook

- Recommended: create a webhook in a Discord Forum channel.
- A webhook in a regular text channel also works, but thread creation using `thread_name` is a Forum-oriented behavior.

### 4) Environment variables

Required:

- `DISCORD_WEBHOOK_URL`: Discord webhook URL (if not set, the plugin does nothing)

Optional:

- `DISCORD_WEBHOOK_USERNAME`: username for webhook posts
- `DISCORD_WEBHOOK_AVATAR_URL`: avatar URL for webhook posts
- `DISCORD_WEBHOOK_COMPLETE_MENTION`: mention to put in `session.idle` / `session.error` messages (only `@everyone` or `@here` supported; Forum webhooks may not actually ping due to Discord behavior)
- `DISCORD_WEBHOOK_PERMISSION_MENTION`: mention to put in `permission.updated` messages (no fallback to `DISCORD_WEBHOOK_COMPLETE_MENTION`; only `@everyone` or `@here` supported; Forum webhooks may not actually ping due to Discord behavior)
- `DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT`: when set to `1`, exclude "input context" (user text parts that start with `<file>`) from notifications (default: `1`; set to `0` to disable)

## Notes / behavior

- If `DISCORD_WEBHOOK_URL` is not set, it becomes a no-op (logs a warning only).
- For Forum thread creation, it appends `?wait=true` and uses `channel_id` in the response as the thread ID.
- `thread_name` priority order (max 100 chars):
  1. first user `text`
  2. session title
  3. `session <sessionID>`
  4. `untitled`
- If thread creation fails (e.g. on non-Forum webhooks), it falls back to posting directly to the channel.
- `permission.updated` / `session.idle` may be queued until the thread name becomes available.
- `session.error` is skipped when `sessionID` is missing in the upstream payload.
- `DISCORD_WEBHOOK_COMPLETE_MENTION=@everyone` (or `@here`) is included as message content, but Forum webhooks may not actually ping.
- `DISCORD_WEBHOOK_PERMISSION_MENTION=@everyone` (or `@here`) is included as message content for `permission.updated`, but Forum webhooks may not actually ping.
- `todo.updated` posts a checklist in the order received (`in_progress` = `[▶]`, `completed` = `[✓]`, `cancelled` excluded). Long lists may be truncated to fit embed constraints.
- `message.updated` is not posted (tracked for role inference; may post a previously-held text part later).
- `message.part.updated` policy:
  - `text`: user is posted immediately; assistant is posted only when finalized (when `part.time.end` exists)
  - `tool`: not posted
  - `reasoning`: not posted (to avoid exposing internal thoughts)

## Manual test

1. Start OpenCode → a new thread appears in the Forum channel on the first notification timing
2. Trigger a permission request → a notification is posted to the same thread (if the thread isn't created yet, it may be created later)
3. Finish the session → `session.idle` is posted
4. Trigger an error → `session.error` is posted (skipped if no `sessionID`)

## Development

- Install deps: `npm i`
- Format: `npx prettier . --write`
- Plugin source: `.opencode/plugin/discord-notification.ts`

PRs and issues are welcome.
