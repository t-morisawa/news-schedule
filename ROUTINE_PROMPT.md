# Claude Code Routine プロンプト

このファイルは [Claude Code routines](https://code.claude.com/docs/ja/routines) で使うプロンプトの雛形です。
[claude.ai/code/routines](https://claude.ai/code/routines) で **New routine** を選び、以下の本文をそのまま貼り付けてください。

ルーティン作成時の選択肢:

- **Repository**: このリポジトリ (`<your-account>/news-schedule`)
- **Schedule**: 例) Daily / 09:00 (Asia/Tokyo)
- **Connectors**: 必要に応じて Playwright MCP を有効化（任意）
- **環境変数**: `DISCORD_WEBHOOK_URL` または `SLACK_WEBHOOK_URL`（最低どちらか1つ）

---

## プロンプト本文（コピペ用）

```
あなたはAIニュース要約エージェントです。次の手順を厳密に実行してください。

# やること
1. リポジトリ直下で `npm ci` を実行（失敗したら `npm install`）
2. `npx playwright install --with-deps chromium` を実行
3. `npm run aggregate` を実行
   - これにより以下4ソースのトップから「AI関連」記事のみが抽出され、
     環境変数 `DISCORD_WEBHOOK_URL` または `SLACK_WEBHOOK_URL` に通知が送信されます
     - https://news.ycombinator.com/
     - https://zenn.dev/
     - https://dev.to/
     - https://qiita.com/
4. 実行後、最終的な標準出力（要約Markdown）をセッションログに保存して完了

# 失敗時の挙動
- いずれかのサイトのスクレイピングが失敗しても他のサイトの結果は通知する（部分成功OK）
- Webhookの通知に失敗した場合のみ、終了コードを非ゼロにし失敗を明示する
- ネットワーク制限などで Playwright が起動できない場合は、その旨をDiscord/Slackに代替通知する

# やらないこと
- 任意のリポジトリへのコミット・プッシュ
- Webhook以外の外部送信
- スクレイピング対象サイトに対するログイン・フォーム入力など破壊的操作
```

---

## 補足: 環境変数の与え方

routines の **Edit routine → 環境** から、ルーティン専用のクラウド環境を選択し、その環境に
以下の Secret を設定するのが推奨です（個別ルーティンに紐づくため共有されません）。

| 名前 | 必須 | 用途 |
| --- | --- | --- |
| `DISCORD_WEBHOOK_URL` | △ | Discord通知（SlackかDiscordのどちらか必須） |
| `SLACK_WEBHOOK_URL` | △ | Slack通知（SlackかDiscordのどちらか必須） |
| `MAX_ITEMS_PER_SOURCE` | – | ソースごとの最大件数（既定 5） |
| `AI_KEYWORDS` | – | カンマ区切りのキーワードを上書きしたい場合のみ |
| `DRY_RUN` | – | `1` で通知を送らずログ出力のみ |

## 補足: Playwright MCP を使う構成にしたい場合

Playwright を Node 経由ではなく [Playwright MCP](https://github.com/microsoft/playwright-mcp) として
使いたい場合は、ルーティンの **Connectors** で Playwright MCP を有効にしたうえで、
プロンプトを以下のようにスクリプトレスにできます。

```
あなたはAIニュース要約エージェントです。次の4サイトのトップページを Playwright MCP で順に開き、
タイトルとURLからAI関連（LLM/GPT/Claude/RAG/エージェント/機械学習などのキーワードを含む）記事のみを
最大5件ずつ抽出してください。
- https://news.ycombinator.com/
- https://zenn.dev/
- https://dev.to/
- https://qiita.com/

最後に、見やすいMarkdownにまとめ、環境変数 DISCORD_WEBHOOK_URL があればDiscordへ、
SLACK_WEBHOOK_URL があればSlackへ、curl で送信してください（リポジトリ内の README.md
「Webhookペイロード仕様」を参照）。
```

どちらの方式でも `MAX_ITEMS_PER_SOURCE` などの環境変数で挙動が制御できます。
