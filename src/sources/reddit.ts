import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";

const SOURCE_URL = "https://www.reddit.com/r/AI_Agents/";
const JSON_URL = "https://www.reddit.com/r/AI_Agents.json?limit=25";

export async function scrapeReddit(
  page: Page,
  _keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  try {
    await page.goto(JSON_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const text = await page.evaluate(() => document.body.innerText ?? document.body.textContent ?? "");

    if (text.includes("Blocked by egress") || text.trim().length < 10) {
      return {
        source: "reddit",
        label: "Reddit r/AI_Agents",
        url: SOURCE_URL,
        articles: [],
        error: "Blocked by egress policy",
      };
    }

    const data = JSON.parse(text) as {
      data: { children: Array<{ data: RedditPost }> };
    };

    const articles: Article[] = [];
    for (const child of data.data.children) {
      const post = child.data;
      if (!post.title) continue;
      const url = post.url.startsWith("http") ? post.url : `https://www.reddit.com${post.url}`;
      articles.push({
        source: "reddit",
        title: post.title,
        url,
        author: post.author || undefined,
        points: post.score ?? undefined,
        comments: post.num_comments ?? undefined,
      });
      if (articles.length >= limit) break;
    }

    return { source: "reddit", label: "Reddit r/AI_Agents", url: SOURCE_URL, articles };
  } catch (e) {
    return {
      source: "reddit",
      label: "Reddit r/AI_Agents",
      url: SOURCE_URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

type RedditPost = {
  title: string;
  url: string;
  author: string;
  score: number;
  num_comments: number;
};
