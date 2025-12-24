# opencode-discord-hook

OpenCode のイベントを Discord Webhook に通知するプラグインです。
Discord の Forum チャンネル webhook を前提に、セッション開始時（または最初の通知タイミング）にスレッド（投稿）を作成して、その後の更新を同スレッドに流します。

## できること

- `session.created`: セッション開始 → 開始通知をキュー（スレッド作成/送信は後続イベントで条件が揃ったタイミングで実行されることがある）
- `session.updated`: セッション更新 → 重要な更新のみ通知（タイトル/共有URL/summary）
- `permission.updated`: 権限要求 → 通知
- `session.idle`: セッション完了 → 通知
- `session.error`: エラー → 通知（`sessionID` が無いケースは通知しない）
- `todo.updated`: Todo 更新 → チェックリスト形式で通知（順序は受信順 / `cancelled` は除外）
- `message.updated`: メッセージ情報更新 → 通知しない（role 判定用に追跡。role 未確定で保留した `text` part を後から通知することがある）
- `message.part.updated`: メッセージ本文/ツール結果更新 → `text` は user は即時通知、assistant は確定時（`time.end`）のみ通知。`tool` は通知しない（`reasoning` は通知しない / 重複イベントは抑制）

## セットアップ

### 1) 依存のインストール

グローバルにインストールします。

- `npm i -g @opencode-ai/plugin`

### 2) プラグイン配置

プロジェクト直下に以下のファイルを置きます。

- `.opencode/plugin/discord-notification.ts`

（グローバルに使いたい場合は `~/.config/opencode/plugin/` 配下でもOKです）

### 3) Discord 側の準備

- Discord の Forum チャンネルで Webhook を作成してください。
- テキストチャンネル webhook でも動きますが、スレッド作成（`thread_name`）は Forum 向けの挙動が前提です。

### 4) 環境変数

必須:

- `DISCORD_WEBHOOK_URL`: Discord webhook URL

任意:

- `DISCORD_WEBHOOK_USERNAME`: 投稿者名
- `DISCORD_WEBHOOK_AVATAR_URL`: アイコン URL
- `DISCORD_WEBHOOK_COMPLETE_MENTION`: `session.idle` / `session.error` の通知に付けるメンション（`@everyone` または `@here` のみサポート）

## 仕様メモ

- Forum スレッド作成時は `?wait=true` を付け、レスポンスの `channel_id` を thread ID として利用します。
- `session.updated` は通知が多くなりやすいため、以下の「重要変化のみ」通知します。
  - タイトルの変化
  - `share.url` の付与/変更
  - `summary` の付与/変更（additions/deletions/files のみ）
- `permission.updated` / `session.updated` / `session.idle` は thread がまだ作られていない場合、いったん通知をキューし、スレッド作成に必要な情報（スレッド名など）が揃ったタイミングで送信されることがあります（取りこぼし防止）。
- `session.error` は upstream の payload で `sessionID` が optional のため、`sessionID` が無い場合は通知しません。
- `DISCORD_WEBHOOK_COMPLETE_MENTION=@everyone` を設定すると、`session.idle` / `session.error` の通知で `@everyone` メンションします（Discord 側で Webhook にメンション権限が必要です）。
- `todo.updated` は、`todos` を受信した順のまま `> [ ]` 形式で通知します（`in_progress` は `[▶]`、`completed` は `[✓]`、`cancelled` は除外）。
- `message.updated` は通知しません（role 判定用に追跡。role 未確定で保留した `text` part を後から通知することがあります）。
- `message.part.updated` は以下の方針です。
  - `text`: user は即時通知。assistant は `part.time.end` がある確定時のみ通知（ストリーミング途中更新は通知しない）
  - `tool`: 通知しない
  - `reasoning`: 通知しない（内部思考が含まれる可能性があるため）

## 動作確認（手動）

1. OpenCode を起動してセッション開始 → 最初の通知タイミングで Forum にスレッドが増える
2. 権限要求が出るケースを作る → 同スレッドに通知（未作成なら後続イベントの通知タイミングでスレッド作成されることがある）
3. タイトル変更・共有URL付与・summary更新が起きる → `session.updated` が通知される
4. セッション完了 → `session.idle` が通知される（`DISCORD_WEBHOOK_COMPLETE_MENTION` 設定時はメンションも飛ぶ）
5. エラー発生 → `session.error` が通知される（`sessionID` 無しは通知されない / `DISCORD_WEBHOOK_COMPLETE_MENTION` 設定時はメンションも飛ぶ）
