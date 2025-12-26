# opencode-discord-notify

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/opencode-discord-notify?logo=npm&logoColor=fff)](https://www.npmjs.com/package/opencode-discord-notify)
[![npm downloads](https://img.shields.io/npm/dm/opencode-discord-notify?logo=npm&logoColor=fff)](https://www.npmjs.com/package/opencode-discord-notify)
[![npm license](https://img.shields.io/npm/l/opencode-discord-notify?logo=npm&logoColor=fff)](https://www.npmjs.com/package/opencode-discord-notify)
![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-4c8bf5)
![Discord Webhook](https://img.shields.io/badge/Discord-Webhook-5865F2?logo=discord&logoColor=fff)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff)

[English](README.md) | 日本語

<!-- markdownlint-disable -->
<p align="center">
  <img src="assets/image/sample-forum-ch.png" width="700" alt="Discord Forum channel example" />
</p>
<!-- markdownlint-enable -->

OpenCode のイベントを Discord Webhook に通知するプラグインです。
Discord の Forum チャンネル webhook を前提に、セッション開始時（または最初の通知タイミング）にスレッド（投稿）を作成して、その後の更新を同スレッドに流します。
通常のテキストチャンネル webhook でも利用できます（その場合はスレッドが作れないため、チャンネルへ直投稿します）。

## できること

- `session.created`: セッション開始 → 開始通知をキュー（スレッド作成/送信は後続イベントで条件が揃ったタイミングで実行されることがある）
- `permission.updated`: 権限要求 → 通知
- `session.idle`: セッション完了 → 通知
- `session.error`: エラー → 通知（`sessionID` が無いケースは通知しない）
- `todo.updated`: Todo 更新 → チェックリスト形式で通知（順序は受信順 / `cancelled` は除外）
- `message.updated`: メッセージ情報更新 → 通知しない（role 判定用に追跡。role 未確定で保留した `text` part を後から通知することがある）
- `message.part.updated`: メッセージ本文/ツール結果更新 → `text` は user は即時通知、assistant は確定時（`time.end`）のみ通知。`tool` は通知しない（`reasoning` は通知しない / 重複イベントは抑制）

## セットアップ

### 1) プラグイン配置

`opencode.json` / `opencode.jsonc` にプラグインを追加します。

OpenCode を再起動してください。

```jsonc
{
  "plugin": ["opencode-discord-notify@latest"],
}
```

### 2) Discord 側の準備

- Discord の Forum チャンネルで Webhook を作成してください。
- テキストチャンネル webhook でも動きますが、スレッド作成（`thread_name`）は Forum 向けの挙動が前提です。

### 3) 環境変数

必須:

- `DISCORD_WEBHOOK_URL`: Discord webhook URL（未設定の場合は no-op）

任意:

- `DISCORD_WEBHOOK_USERNAME`: 投稿者名
- `DISCORD_WEBHOOK_AVATAR_URL`: アイコン URL
- `DISCORD_WEBHOOK_COMPLETE_MENTION`: `session.idle` / `session.error` の通知本文に付けるメンション（`@everyone` または `@here` のみ許容。Forum webhook の仕様上、ping は常に発生しない）
- `DISCORD_WEBHOOK_PERMISSION_MENTION`: `permission.updated` の通知本文に付けるメンション（`DISCORD_WEBHOOK_COMPLETE_MENTION` へのフォールバックなし。`@everyone` または `@here` のみ許容。Forum webhook の仕様上、ping は常に発生しない）
- `DISCORD_WEBHOOK_EXCLUDE_INPUT_CONTEXT`: `1` のとき input context（`<file>` から始まる user `text` part）を通知しない（デフォルト: `1` / `0` で無効化）
- `SEND_PARAMS`: embed の fields として送るキーをカンマ区切りで指定。指定可能キー: `sessionID`, `permissionID`, `type`, `pattern`, `messageID`, `callID`, `partID`, `role`, `directory`, `projectID`。未設定・空文字・空要素のみの場合は全て選択。`session.created` は `SEND_PARAMS` に関わらず `sessionID`, `projectID`, `directory` を必ず含みます。

## 仕様メモ

- `DISCORD_WEBHOOK_URL` 未設定の場合は no-op（ログに警告のみ）です。
- Forum スレッド作成時は `?wait=true` を付け、レスポンスの `channel_id` を thread ID として利用します。
- スレッド名（`thread_name`）は以下の優先度です（最大100文字）。
  1. 最初の user `text`
  2. session title
  3. `session <sessionID>`
  4. `untitled`
- Forum スレッド作成に失敗した場合は、取りこぼし防止のためチャンネル直投稿にフォールバックします（テキストチャンネル webhook など）。
- `permission.updated` / `session.idle` は thread がまだ作られていない場合、いったん通知をキューし、スレッド作成に必要な情報（スレッド名など）が揃ったタイミングで送信されることがあります（取りこぼし防止）。
- `session.error` は upstream の payload で `sessionID` が optional のため、`sessionID` が無い場合は通知しません。
- `DISCORD_WEBHOOK_COMPLETE_MENTION=@everyone`（または `@here`）を設定すると、通知本文にその文字列を含めて投稿します。ただし Forum webhook の仕様上、ping は常に発生しません（文字列として表示されるだけ）。
- `DISCORD_WEBHOOK_PERMISSION_MENTION=@everyone`（または `@here`）を設定すると、`permission.updated` の通知本文にその文字列を含めて投稿します。ただし Forum webhook の仕様上、ping は常に発生しません（文字列として表示されるだけ）。
- `todo.updated` は、`todos` を受信した順のままチェックリスト形式で通知します（`in_progress` は `[▶]`、`completed` は `[✓]`、`cancelled` は除外）。長い/大量の todo は Discord embed の制約に合わせて省略されることがあります（空の場合は `(no todos)` / 省略時は `...and more` を付与）。
- `message.updated` は通知しません（role 判定用に追跡。role 未確定で保留した `text` part を後から通知することがあります）。
- `message.part.updated` は以下の方針です。
  - `text`: user は即時通知。assistant は `part.time.end` がある確定時のみ通知（ストリーミング途中更新は通知しない）
  - `tool`: 通知しない
  - `reasoning`: 通知しない（内部思考が含まれる可能性があるため）
- `SEND_PARAMS` の制御対象は embed の fields のみです（title/description/content/timestamp などは対象外）。また `share` は fields としては送りません（Session started の embed URL には `shareUrl` を使います）。

## 動作確認（手動）

1. OpenCode を起動してセッション開始 → 最初の通知タイミングで Forum にスレッドが増える
2. 権限要求が出るケースを作る → 同スレッドに通知（未作成なら後続イベントの通知タイミングでスレッド作成されることがある）
3. セッション完了 → `session.idle` が通知される（`DISCORD_WEBHOOK_COMPLETE_MENTION` 設定時は本文に `@everyone` / `@here` を含めて投稿するが Forum webhook では ping は発生しない）
4. エラー発生 → `session.error` が通知される（`sessionID` 無しは通知されない / `DISCORD_WEBHOOK_COMPLETE_MENTION` 設定時は本文に `@everyone` / `@here` を含めて投稿するが Forum webhook では ping は発生しない）

## 開発

- 依存のインストール: `npm i`
- フォーマット: `npx prettier . --write`
- プラグイン本体: `src/index.ts`

## 今後の展望（予定）

- npm パッケージとして公開（インストール/更新を簡単にする）
- 複数 webhook / 複数チャンネル対応（用途別に振り分け）
- 通知内容のカスタマイズ（通知するイベント、本文テンプレ、メンション付与ポリシーなど）
  - 設定ファイル（例: `opencode-discord-notify.config.json`）を読み取り、必要に応じて環境変数から値を解決する方式も検討
- Discord の制限対策を強化（レート制限時のリトライ、分割投稿、長文省略ルールの改善）
- CI 整備（lint/format の自動化、簡単なテスト追加）

**PR / Issue 大歓迎です。**
