import Anthropic from "@anthropic-ai/sdk";
import type { Page } from "playwright";
import type { Article } from "./types.js";

const SYSTEM_PROMPT =
  "あなたはAI・テック系ニュースの要約専門家です。与えられた記事を日本語で3〜5文で要約してください。英語の記事も必ず日本語で要約してください。専門用語はそのまま使い、要点を簡潔にまとめてください。";

async function fetchPageText(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  return page.evaluate(() => {
    const candidates = [
      "article",
      "main",
      "[class*='article']",
      "[class*='post-body']",
      "[class*='content']",
      "[class*='entry']",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && (el.textContent?.length ?? 0) > 300) {
        return el.textContent!.replace(/\s+/g, " ").trim().slice(0, 5000);
      }
    }
    return document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 5000) ?? "";
  });
}

export async function summarizeArticle(
  page: Page,
  article: Article,
  client: Anthropic,
): Promise<string> {
  let text: string;
  try {
    text = await fetchPageText(page, article.url);
  } catch {
    return "（記事の取得に失敗しました）";
  }

  if (text.trim().length < 100) {
    return "（記事の内容を取得できませんでした）";
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `タイトル: ${article.title}\n\n${text}`,
        },
      ],
    });
    const block = response.content[0];
    return block && block.type === "text" ? block.text.trim() : "（要約できませんでした）";
  } catch {
    return "（要約の生成に失敗しました）";
  }
}

export async function summarizeAll(
  newPage: () => Promise<Page>,
  articles: ReadonlyArray<Article>,
  client: Anthropic,
): Promise<Map<string, string>> {
  const summaries = new Map<string, string>();
  for (const article of articles) {
    const page = await newPage();
    try {
      const summary = await summarizeArticle(page, article, client);
      summaries.set(article.url, summary);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return summaries;
}
