# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an OpenCode plugin that sends real-time notifications to Discord via webhooks. It creates organized threads in Discord Forum channels for each OpenCode session, tracking events like session lifecycle, permissions, todos, and conversations.

## Development Commands

### Setup

```bash
npm install
```

### Testing

```bash
npm test                    # Run all tests (uses Bun)
bun test src/index.test.ts  # Run specific test file
```

### Building

```bash
npm run build              # Build with tsup (outputs to dist/)
```

### Formatting

```bash
npm run format             # Format code with Prettier
```

### Publishing

```bash
npm run prepublishOnly     # Automatically runs build before publish
```

## Architecture

### Queue-Based Message Delivery System

The plugin uses a **persistent queue** architecture to ensure reliable message delivery:

**Flow**: OpenCode Event → Enqueue to SQLite DB → Background Worker → Discord API

**Key Components**:

1. **PersistentQueue** (`src/queue/persistent-queue.ts`)
   - SQLite-backed message queue
   - Database location: `~/.config/opencode/discord-notify-queue.db` (customizable via `DISCORD_NOTIFY_QUEUE_DB_PATH`)
   - Schema: `discord_queue` table with columns for `session_id`, `thread_id`, `webhook_body`, `retry_count`, `last_error`
   - Operations: `enqueue()`, `dequeue()`, `delete()`, `updateThreadId()`, `updateRetryCount()`

2. **QueueWorker** (`src/queue/worker.ts`)
   - Background worker that polls the queue every 1 second
   - Processes **1 message at a time** (BATCH_SIZE=1) to ensure thread ID consistency
   - Auto-start: Begins when first user message is sent
   - Auto-stop: Stops when queue is empty
   - Retry logic: Max 5 retries per message, tracks retry count in DB

3. **Database Initialization** (`src/utils/db.ts`)
   - Uses Bun's SQLite implementation (`bun:sqlite`)
   - WAL mode enabled for performance
   - Test environment uses `:memory:` database
   - Creates table and indexes on initialization

### Thread Creation & Naming

**Thread Naming Priority** (max 100 chars):

1. First user text message from session
2. Session title from `session.created` event
3. `session <sessionID>`
4. `"(untitled)"`

**Thread Creation Flow**:

- `session.created` event is cached but NOT immediately sent
- First user message triggers: session.created embed → user message embed
- Worker creates Discord thread with `thread_name` on first message
- Thread ID (`channel_id`) is stored and used for subsequent messages in that session

**Why this matters**: If session.created was sent immediately, the worker might process it before the user's first message arrives, resulting in threads named with session title instead of user's actual first message.

### Event Handling

The main plugin (`src/index.ts`) handles these OpenCode events:

- **`session.created`**: Cached in `lastSessionInfo` Map, enqueued on first user message
- **`message.updated`**: Tracks role (user/assistant) in `messageRoleById` Map
- **`message.part.updated`**:
  - User text: Sent immediately when `part.time.end` exists
  - Assistant text: Saved to `lastAssistantMessageBySession` Map when finalized
  - Input context (starts with `<file>`): Excluded by default (configurable)
- **`session.idle`**: Includes last assistant message in embed description (v0.8.0+)
- **`session.error`**: Sends error notification with mention
- **`permission.updated`**: Sends permission request immediately (not queued)
- **`todo.updated`**: Sends visual checklist with status markers

### State Management (In-Memory Maps)

Critical state stored in memory (lost on process restart):

- `sessionToThread`: Maps sessionID → Discord threadID
- `firstUserTextBySession`: First user message per session (for thread naming)
- `lastAssistantMessageBySession`: Latest assistant message per session (for session.idle)
- `lastSessionInfo`: Cached session metadata from session.created
- `sentTextPartIds`: Set of already-sent part IDs (deduplication)
- `pendingTextPartsByMessageId`: Parts waiting for role detection
- `messageRoleById`: Message role cache (user/assistant)

### Fallback Webhook System

Discord Forum webhooks don't trigger pings for `@everyone`/`@here`. Solution:

- Primary webhook (`DISCORD_WEBHOOK_URL`): Forum channel (organized threads)
- Fallback webhook (`DISCORD_WEBHOOK_FALLBACK_URL`): Text channel (actual pings)
- Messages with mentions are sent to **both** webhooks
- Fallback always includes `sessionID` and `thread title` fields for context

### Discord API Constraints

- Embed description: Max 4096 characters (truncated with `truncateText()`)
- Embed field value: Max 1024 characters
- Thread name: Max 100 characters
- Rate limit handling: Waits for `retry_after` header, retries once after 10s delay

### Environment Variables

All configuration is via environment variables. Key ones:

- `DISCORD_WEBHOOK_URL` (required): Primary Discord webhook
- `DISCORD_WEBHOOK_COMPLETE_INCLUDE_LAST_MESSAGE` (default: `1`): Include last assistant message in session.idle notifications
- `DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT` (default: `1`): Exclude file context from notifications
- `DISCORD_SEND_PARAMS`: Comma-separated list of metadata fields to include in embeds
- `DISCORD_NOTIFY_QUEUE_DB_PATH`: Custom database path

## Testing Strategy

- Tests use Bun's test runner (Vitest-compatible)
- Test database is always `:memory:` (check `process.env.NODE_ENV === 'test'`)
- Mock `globalThis.fetch` for Discord API calls
- Use `waitForQueueWorker()` helper to wait for async queue processing
- Test files colocated with source: `*.test.ts` alongside `*.ts`

## Code Organization

```text
src/
├── index.ts              # Main plugin export, event handlers, Discord logic
├── queue/
│   ├── types.ts         # TypeScript types for queue system
│   ├── persistent-queue.ts  # SQLite queue implementation
│   └── worker.ts        # Background worker for processing queue
└── utils/
    └── db.ts            # Database initialization and path resolution
```

## Important Implementation Details

### Why Option 3 for session.created

The codebase uses "Option 3" for `session.created` event handling:

- Event is cached but NOT enqueued immediately
- Enqueued only when first user message arrives
- Prevents race condition where worker processes session.created before user text is available
- Ensures thread name uses actual user message, not session title

### Global Registration Guard

Plugin uses global guard (`__opencode_discord_notify_registered__`) to prevent double registration when module is reloaded.

### Message Deduplication

Uses `sentTextPartIds` Set to track sent part IDs and prevent duplicate messages when events are replayed or re-sent.

### Retry Strategy

- Max 5 retries with exponential backoff via queue system
- Each retry updates `retry_count` and `last_error` in database
- Toast notifications show retry progress (e.g., "Retry 3/5")
- After max retries, message is deleted and error notification shown

## Version Bumping

When releasing new features, bump version in `package.json`. Follow semantic versioning:

- Patch (0.7.x → 0.7.y): Bug fixes
- Minor (0.7.x → 0.8.0): New features (backward compatible)
- Major (0.x.y → 1.0.0): Breaking changes
