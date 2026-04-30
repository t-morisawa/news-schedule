# news-schedule

> Hacker News / Zenn / dev.to / Qiita の4ソースから **AI関連トピック** を集めて、
> Discord または Slack の Webhook に通知する小さなジョブ。
> [Claude Code Routines](https://code.claude.com/docs/ja/routines) で定期実行することを前提に作られています。

## できること

- 4 つの公開サイトのトップを Playwright で巡回
  - <https://news.ycombinator.com/>
  - <https://zenn.dev/>
  - <https://dev.to/>
  - <https://qiita.com/>
- タイトル / タグから **AI 関連の記事のみ** を抽出（キーワードはカスタマイズ可）
- 結果を Markdown にまとめて Discord / Slack の Incoming Webhook へ送信
- スケジュール実行は Claude Code の Routines に任せる（ローカル/CIでも動かせます）

## 動作要件

- Node.js 20.10 以上
- Chromium（`npx playwright install chromium` で自動取得）

## セットアップ

```bash
git clone https://github.com/<your-account>/news-schedule.git
cd news-schedule
npm install
npx playwright install --with-deps chromium
cp .env.example .env
# .env を編集してWebhookを設定
```

## ローカルで試す

```bash
# Webhookに送らず標準出力だけ確認
DRY_RUN=1 npm run aggregate

# 実際にWebhookへ通知
npm run aggregate
```

## 環境変数

| 名前 | 必須 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | △ | – | Discord 通知先（`SLACK_WEBHOOK_URL` とどちらか1つ必須） |
| `SLACK_WEBHOOK_URL` | △ | – | Slack 通知先（Incoming Webhook URL） |
| `MAX_ITEMS_PER_SOURCE` | – | `5` | 各ソースから抽出する最大件数 |
| `AI_KEYWORDS` | – | 内蔵デフォルト | カンマ区切りで判定キーワードを上書き |
| `SCRAPE_TIMEOUT_MS` | – | `30000` | ページ取得のタイムアウト（ms） |
| `DRY_RUN` | – | – | `1` で Webhook送信をスキップ |

両方の Webhook URL を設定すると Discord / Slack の両方に投稿します。

## Claude Code Routines で動かす

### 1. このリポジトリを Public で GitHub に置く

`gh repo create news-schedule --public --source=. --push` などでOKです。

### 2. Routine を作成

[claude.ai/code/routines](https://claude.ai/code/routines) で **New routine** を作成し、
[`ROUTINE_PROMPT.md`](./ROUTINE_PROMPT.md) のプロンプト本文をコピペします。

設定の目安:

| 項目 | 推奨値 |
| --- | --- |
| Repository | `<your-account>/news-schedule` |
| Trigger | Schedule（例: 毎日 09:00 JST） |
| Environment | Default 環境 + `DISCORD_WEBHOOK_URL` または `SLACK_WEBHOOK_URL` を Secret として登録 |
| Connectors | 不要（標準のシェル実行のみで完結） |
| Allow unrestricted branch pushes | OFF（このルーティンはプッシュしません） |

> Routines はクラウド環境でリポジトリをクローンし、シェルコマンドを実行します。
> 本リポジトリの `npm run aggregate` をそのまま叩く形です。

### 3. すぐ確認

ルーティン詳細ページの **Run now** で即時実行できます。
Webhook に通知が届けば成功です。

> 任意で Playwright MCP を使った "スクリプトレス" 構成にもできます。
> 詳細は [`ROUTINE_PROMPT.md`](./ROUTINE_PROMPT.md) の補足セクションを参照してください。

## 出力例（Discord）

```
📰 AIトレンドまとめ (2026/4/30 9:00:00)
合計 12 件 / 4ソース

## Hacker News  (3)
- [Show HN: ...](https://news.ycombinator.com/item?id=...)  _128pt · 💬42 · @someuser_
- ...

## Zenn  (4)
- [LLMエージェント設計の勘所](https://zenn.dev/...)
- ...

## DEV Community  (3)
- [Building RAG with...](https://dev.to/...)  _#ai #rag #llm_
- ...

## Qiita  (2)
- [Claude Codeで...](https://qiita.com/...)  _#claude #ai_
- ...
```

## ファイル構成

```
src/
├── index.ts            # エントリポイント
├── config.ts           # 環境変数 / キーワード判定
├── browser.ts          # Playwrightのブラウザ起動
├── notify.ts           # Discord/Slack Webhook送信
├── types.ts            # 型定義
└── sources/
    ├── hackernews.ts
    ├── zenn.ts
    ├── devto.ts
    └── qiita.ts
ROUTINE_PROMPT.md       # Claude Code Routines用プロンプト
.env.example            # 環境変数のテンプレ
```

## ライセンス

MIT
