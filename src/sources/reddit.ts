import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";

const SUBREDDIT = "AI_Agents";
const SOURCE_URL = `https://www.reddit.com/r/${SUBREDDIT}/`;
const JSON_URL = `https://www.reddit.com/r/${SUBREDDIT}/hot.json?limit=25&raw_json=1`;

export async function scrapeReddit(
  page: Page,
  _keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  try {
    await page.setExtraHTTPHeaders({
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    });

    const response = await page.goto(JSON_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response?.status() ?? "unknown"}: ${await response?.text().then(t => t.slice(0, 100)).catch(() => "")}`);
    }

    const jsonText = await page.evaluate(() => document.body.innerText);
    const json = JSON.parse(jsonText) as {
      data?: {
        children?: Array<{
          data?: {
            title?: string;
            permalink?: string;
            author?: string;
            score?: number;
            num_comments?: number;
            url?: string;
          };
        }>;
      };
    };

    const children = json?.data?.children ?? [];
    const articles: Article[] = [];

    for (const child of children) {
      const d = child.data;
      if (!d?.title) continue;

      const url = d.permalink
        ? `https://www.reddit.com${d.permalink}`
        : (d.url ?? "");
      if (!url) continue;

      articles.push({
        source: "reddit",
        title: d.title,
        url,
        author: d.author || undefined,
        points: d.score,
        comments: d.num_comments,
      });
      if (articles.length >= limit) break;
    }

    return {
      source: "reddit",
      label: "Reddit r/AI_Agents",
      url: SOURCE_URL,
      articles,
    };
  } catch (e) {
    // Try scraping the HTML page as fallback
    try {
      return await scrapeRedditHtml(page, limit);
    } catch {
      return {
        source: "reddit",
        label: "Reddit r/AI_Agents",
        url: SOURCE_URL,
        articles: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

async function scrapeRedditHtml(page: Page, limit: number): Promise<SourceResult> {
  await page.goto(`https://old.reddit.com/r/AI_Agents/`, {
    waitUntil: "domcontentloaded",
    timeout: 25_000,
  });

  await page.waitForSelector("#siteTable", { timeout: 15_000 });

  const raw = await page.$$eval("div.thing.link", (things) =>
    things.map((t) => {
      const titleEl = t.querySelector("a.title");
      const title = titleEl?.textContent?.trim() ?? "";
      const href = titleEl?.getAttribute("href") ?? "";
      const author = t.querySelector(".author")?.textContent?.trim() ?? "";
      const score = t.querySelector(".score")?.getAttribute("title") ?? "0";
      const commentsText = t.querySelector("a.comments")?.textContent?.trim() ?? "0";
      return { title, href, author, score, commentsText };
    }),
  );

  const articles: Article[] = [];
  for (const item of raw) {
    if (!item.title) continue;
    const url = item.href.startsWith("http")
      ? item.href
      : `https://old.reddit.com${item.href}`;
    const points = Number.parseInt(item.score, 10) || undefined;
    const commentsMatch = item.commentsText.match(/\d+/);
    const comments = commentsMatch ? Number.parseInt(commentsMatch[0], 10) : undefined;
    articles.push({
      source: "reddit",
      title: item.title,
      url,
      author: item.author || undefined,
      points,
      comments,
    });
    if (articles.length >= limit) break;
  }

  return {
    source: "reddit",
    label: "Reddit r/AI_Agents",
    url: SOURCE_URL,
    articles,
  };
}
