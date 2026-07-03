import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";
import { isAIRelated } from "../config.js";
import { gotoWithRetry } from "../browser.js";

const URL = "https://news.ycombinator.com/";

export async function scrapeHackerNews(
  page: Page,
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  try {
    await gotoWithRetry(page, URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("tr.athing", { timeout: 15_000 });

    const raw = await page.$$eval("tr.athing", (rows) =>
      rows.map((row) => {
        const id = row.getAttribute("id") ?? "";
        const titleEl = row.querySelector(".titleline > a");
        const title = titleEl?.textContent?.trim() ?? "";
        const url = titleEl?.getAttribute("href") ?? "";
        const subline = row.nextElementSibling;
        const score = subline?.querySelector(".score")?.textContent ?? "";
        const author = subline?.querySelector(".hnuser")?.textContent ?? "";
        const commentLink = subline?.querySelectorAll("a")[
          (subline?.querySelectorAll("a").length ?? 1) - 1
        ];
        const commentsText = commentLink?.textContent ?? "";
        return { id, title, url, score, author, commentsText };
      }),
    );

    const articles: Article[] = [];
    for (const item of raw) {
      if (!item.title) continue;
      if (!isAIRelated(item.title, keywords)) continue;

      const url = item.url.startsWith("http")
        ? item.url
        : `https://news.ycombinator.com/${item.url}`;

      const points = parseIntOrUndefined(item.score.replace(/[^0-9]/g, ""));
      const comments = parseIntOrUndefined(item.commentsText.replace(/[^0-9]/g, ""));

      articles.push({
        source: "hackernews",
        title: item.title,
        url,
        author: item.author || undefined,
        points,
        comments,
      });
      if (articles.length >= limit) break;
    }

    return {
      source: "hackernews",
      label: "Hacker News",
      url: URL,
      articles,
    };
  } catch (e) {
    return {
      source: "hackernews",
      label: "Hacker News",
      url: URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function parseIntOrUndefined(s: string): number | undefined {
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}
