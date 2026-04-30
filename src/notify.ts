import type { SourceResult } from "./types.js";

export type NotifyTarget = Readonly<{
  discordWebhookUrl?: string;
  slackWebhookUrl?: string;
}>;

export function buildSummary(results: ReadonlyArray<SourceResult>): string {
  const date = new Date();
  const stamp = date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const totalArticles = results.reduce((s, r) => s + r.articles.length, 0);

  const lines: string[] = [];
  lines.push(`📰 **AIトレンドまとめ** (${stamp})`);
  lines.push(`合計 ${totalArticles} 件 / 4ソース`);
  lines.push("");

  for (const r of results) {
    lines.push(`## ${r.label}  (${r.articles.length})`);
    if (r.error) {
      lines.push(`> ⚠️ 取得エラー: ${r.error}`);
      lines.push("");
      continue;
    }
    if (r.articles.length === 0) {
      lines.push(`> AI関連の記事は見つかりませんでした`);
      lines.push("");
      continue;
    }
    for (const a of r.articles) {
      const meta: string[] = [];
      if (a.points !== undefined) meta.push(`${a.points}pt`);
      if (a.comments !== undefined) meta.push(`💬${a.comments}`);
      if (a.author) meta.push(`@${a.author}`);
      if (a.tags && a.tags.length > 0) meta.push(a.tags.slice(0, 3).map((t) => `#${t}`).join(" "));
      const metaStr = meta.length > 0 ? `  _${meta.join(" · ")}_` : "";
      lines.push(`- [${a.title}](${a.url})${metaStr}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function postToDiscord(webhookUrl: string, content: string): Promise<void> {
  // Discordは1メッセージ最大2000文字
  const chunks = chunkString(content, 1900);
  for (const chunk of chunks) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: chunk, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Discord webhook failed: ${res.status} ${res.statusText} ${body}`);
    }
  }
}

export async function postToSlack(webhookUrl: string, content: string): Promise<void> {
  // Slack Incoming Webhookはmrkdwn。改行・リンクを互換変換。
  const slackText = toSlackMrkdwn(content);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: slackText }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Slack webhook failed: ${res.status} ${res.statusText} ${body}`);
  }
}

export async function notifyAll(target: NotifyTarget, content: string): Promise<void> {
  const tasks: Array<Promise<void>> = [];
  if (target.discordWebhookUrl) tasks.push(postToDiscord(target.discordWebhookUrl, content));
  if (target.slackWebhookUrl) tasks.push(postToSlack(target.slackWebhookUrl, content));
  if (tasks.length === 0) {
    throw new Error(
      "DISCORD_WEBHOOK_URLまたはSLACK_WEBHOOK_URLのいずれかを環境変数に設定してください",
    );
  }
  await Promise.all(tasks);
}

function chunkString(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let buf = "";
  for (const line of s.split("\n")) {
    if ((buf + "\n" + line).length > max) {
      if (buf.length > 0) out.push(buf);
      buf = line;
    } else {
      buf = buf.length === 0 ? line : `${buf}\n${line}`;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function toSlackMrkdwn(md: string): string {
  // Markdown [text](url) → Slack <url|text>
  let out = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
  // 太字 **text** → *text*
  out = out.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  // 見出し ## → 太字
  out = out.replace(/^##\s*(.+)$/gm, "*$1*");
  return out;
}
