/**
 * Playwright不要のNode.js fetch版スクレイパー。
 * 各ソースの公開APIを使ってAI関連記事を収集する。
 */
import { loadConfig, isAIRelated } from "./config.js";
import type { Article, SourceResult } from "./types.js";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  Accept: "application/json, text/html",
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json() as Promise<T>;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { ...HEADERS, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return "";
  return res.text();
}

function extractBodyText(html: string): string {
  // Remove scripts/styles/tags, decode entities, truncate
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

// ──────────────────────────────────────────────────────────────────────────────
// Hacker News
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeHackerNews(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const SOURCE_URL = "https://news.ycombinator.com/";
  try {
    const topIds = await fetchJson<number[]>(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
    );

    const articles: Article[] = [];
    for (const id of topIds.slice(0, 100)) {
      if (articles.length >= limit) break;
      const item = await fetchJson<{
        id: number;
        title?: string;
        url?: string;
        by?: string;
        score?: number;
        descendants?: number;
        type?: string;
      }>(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);

      if (item.type !== "story") continue;
      if (!item.title) continue;
      if (!isAIRelated(item.title, keywords)) continue;

      const url = item.url ?? `https://news.ycombinator.com/item?id=${item.id}`;
      articles.push({
        source: "hackernews",
        title: item.title,
        url,
        author: item.by,
        points: item.score,
        comments: item.descendants,
      });
    }

    return { source: "hackernews", label: "Hacker News", url: SOURCE_URL, articles };
  } catch (e) {
    return {
      source: "hackernews",
      label: "Hacker News",
      url: SOURCE_URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Zenn
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeZenn(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const SOURCE_URL = "https://zenn.dev/";
  try {
    const data = await fetchJson<{
      articles: Array<{
        id: number;
        title: string;
        slug: string;
        user?: { username?: string };
        liked_count?: number;
        published_at?: string;
        topics?: Array<{ name: string }>;
      }>;
    }>("https://zenn.dev/api/articles?order=latest&count=50");

    const articles: Article[] = [];
    for (const item of data.articles) {
      if (articles.length >= limit) break;
      const haystack = `${item.title} ${(item.topics ?? []).map((t) => t.name).join(" ")}`;
      if (!isAIRelated(haystack, keywords)) continue;

      articles.push({
        source: "zenn",
        title: item.title,
        url: `https://zenn.dev/${item.user?.username ?? "_"}/articles/${item.slug}`,
        author: item.user?.username,
        points: item.liked_count,
        publishedAt: item.published_at,
        tags: (item.topics ?? []).map((t) => t.name),
      });
    }

    return { source: "zenn", label: "Zenn", url: SOURCE_URL, articles };
  } catch (e) {
    return {
      source: "zenn",
      label: "Zenn",
      url: SOURCE_URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// DEV.to
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeDevTo(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const SOURCE_URL = "https://dev.to/";
  try {
    const items = await fetchJson<
      Array<{
        id: number;
        title: string;
        url: string;
        user?: { username?: string };
        positive_reactions_count?: number;
        comments_count?: number;
        published_at?: string;
        tag_list?: string[];
        description?: string;
      }>
    >("https://dev.to/api/articles?top=1&per_page=50");

    const articles: Article[] = [];
    for (const item of items) {
      if (articles.length >= limit) break;
      const haystack = `${item.title} ${(item.tag_list ?? []).join(" ")} ${item.description ?? ""}`;
      if (!isAIRelated(haystack, keywords)) continue;

      articles.push({
        source: "devto",
        title: item.title,
        url: item.url,
        author: item.user?.username,
        points: item.positive_reactions_count,
        comments: item.comments_count,
        publishedAt: item.published_at,
        tags: item.tag_list,
        excerpt: item.description,
      });
    }

    return { source: "devto", label: "DEV Community", url: SOURCE_URL, articles };
  } catch (e) {
    return {
      source: "devto",
      label: "DEV Community",
      url: SOURCE_URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Qiita
// ──────────────────────────────────────────────────────────────────────────────
async function scrapeQiita(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const SOURCE_URL = "https://qiita.com/";
  try {
    // 直近の人気記事をタグ検索
    const items = await fetchJson<
      Array<{
        id: string;
        title: string;
        url: string;
        user?: { id?: string };
        likes_count?: number;
        comments_count?: number;
        created_at?: string;
        tags?: Array<{ name: string }>;
        body?: string;
      }>
    >("https://qiita.com/api/v2/items?page=1&per_page=50&query=stocks%3A%3E10");

    const articles: Article[] = [];
    for (const item of items) {
      if (articles.length >= limit) break;
      const haystack = `${item.title} ${(item.tags ?? []).map((t) => t.name).join(" ")}`;
      if (!isAIRelated(haystack, keywords)) continue;

      articles.push({
        source: "qiita",
        title: item.title,
        url: item.url,
        author: item.user?.id,
        points: item.likes_count,
        comments: item.comments_count,
        publishedAt: item.created_at,
        tags: (item.tags ?? []).map((t) => t.name),
      });
    }

    return { source: "qiita", label: "Qiita", url: SOURCE_URL, articles };
  } catch (e) {
    return {
      source: "qiita",
      label: "Qiita",
      url: SOURCE_URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Body text fetcher
// ──────────────────────────────────────────────────────────────────────────────
async function fetchBodyText(url: string): Promise<string> {
  try {
    const html = await fetchHtml(url);
    return extractBodyText(html);
  } catch {
    return "";
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const config = loadConfig();
  const { aiKeywords, maxItemsPerSource } = config;

  const settled = await Promise.allSettled([
    scrapeHackerNews(aiKeywords, maxItemsPerSource),
    scrapeZenn(aiKeywords, maxItemsPerSource),
    scrapeDevTo(aiKeywords, maxItemsPerSource),
    scrapeQiita(aiKeywords, maxItemsPerSource),
  ]);

  const scraped = settled
    .filter((s): s is PromiseFulfilledResult<SourceResult> => s.status === "fulfilled")
    .map((s) => s.value);

  // Fetch body text for each article
  const enriched: SourceResult[] = [];
  for (const r of scraped) {
    const articlesWithBody: Article[] = [];
    for (const article of r.articles) {
      const bodyText = await fetchBodyText(article.url);
      articlesWithBody.push({ ...article, bodyText });
    }
    enriched.push({ ...r, articles: articlesWithBody });
  }

  const output = {
    timestamp: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
    sources: enriched.map((r) => ({
      label: r.label,
      error: r.error ?? null,
      articles: r.articles,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
