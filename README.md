# opencode-discord-hook

OpenCode のイベントを Discord Webhook に通知するプラグインです。
Discord の Forum チャンネル webhook を前提に、セッション開始時にスレッド（投稿）を作成して、その後の更新を同スレッドに流します。

## できること

- `session.created`: セッション開始 → Forum スレッド作成 + 開始通知
- `session.updated`: セッション更新 → 重要な更新のみ通知（タイトル/共有URL/summary）
- `permission.updated`: 権限要求 → 通知
- `session.idle`: セッション完了 → 通知
- `session.error`: エラー → 通知（`sessionID` が無いケースは通知しない）

## セットアップ

### 1) プラグイン配置

プロジェクト直下に以下のファイルを置きます。

- `.opencode/plugin/discord-notification.ts`

（グローバルに使いたい場合は `~/.config/opencode/plugin/` 配下でもOKです）

### 2) Discord 側の準備

- Discord の Forum チャンネルで Webhook を作成してください。
- テキストチャンネル webhook でも動きますが、スレッド作成（`thread_name`）は Forum 向けの挙動が前提です。

### 3) 環境変数

必須:

- `DISCORD_WEBHOOK_URL`: Discord webhook URL

任意:

- `DISCORD_WEBHOOK_USERNAME`: 投稿者名
- `DISCORD_WEBHOOK_AVATAR_URL`: アイコン URL

## 仕様メモ

- Forum スレッド作成時は `?wait=true` を付け、レスポンスの `channel_id` を thread ID として利用します。
- `session.updated` は通知が多くなりやすいため、以下の「重要変化のみ」通知します。
  - タイトルの変化
  - `share.url` の付与/変更
  - `summary` の付与/変更（additions/deletions/files のみ）
- `permission.updated` / `session.updated` / `session.idle` は thread がまだ作られていない場合でも、通知時に `thread_name` 付きで投稿してスレッドを遅延作成します（取りこぼし防止）。
- `session.error` は upstream の payload で `sessionID` が optional のため、`sessionID` が無い場合は通知しません。

## 動作確認（手動）

1. OpenCode を起動してセッション開始 → Forum にスレッドが増える
2. 権限要求が出るケースを作る → 同スレッドに通知（未作成なら通知時にスレッド作成）
3. タイトル変更・共有URL付与・summary更新が起きる → `session.updated` が通知される
4. セッション完了 → `session.idle` が通知される
5. エラー発生 → `session.error` が通知される（`sessionID` 無しは通知されない）
