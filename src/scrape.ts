import { loadConfig, isAIRelated } from "./config.js";
import type { Article, SourceResult } from "./types.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json" } });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodyText(html: string): string {
  // Try to find article/main content first
  for (const tag of ["article", "main"]) {
    const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (m && m[1].length > 300) {
      return stripHtml(m[1]).slice(0, 4000);
    }
  }
  // Fallback: extract body
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return stripHtml(body ? body[1] : html).slice(0, 4000);
}

async function fetchBodyText(url: string): Promise<string> {
  const html = await fetchText(url, 20_000);
  return extractBodyText(html);
}

// ── HackerNews ──────────────────────────────────────────────────────────────
async function scrapeHackerNews(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const url = "https://news.ycombinator.com/";
  try {
    const html = await fetchText(url);
    const articles: Article[] = [];

    // Each story row: <tr class="athing submission" id="12345">
    const rowRe = /<tr[^>]+class="athing submission"[^>]+id="(\d+)"[^>]*>([\s\S]*?)<\/tr>\s*<tr>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null && articles.length < limit) {
      const id = m[1];
      const titleBlock = m[2];
      const subBlock = m[3];

      const titleMatch = titleBlock.match(/<span class="titleline">\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
      if (!titleMatch) continue;

      const rawUrl = titleMatch[1];
      const title = titleMatch[2].replace(/&amp;/g, "&").replace(/&#x27;/g, "'").trim();
      if (!isAIRelated(title, keywords)) continue;

      const articleUrl = rawUrl.startsWith("http") ? rawUrl : `https://news.ycombinator.com/${rawUrl}`;

      const scoreMatch = subBlock.match(/<span class="score"[^>]*>(\d+)/);
      const authorMatch = subBlock.match(/class="hnuser"[^>]*>([^<]+)<\/a>/);
      const commentsMatch = subBlock.match(/(\d+)&nbsp;comment/);

      articles.push({
        source: "hackernews",
        title,
        url: articleUrl,
        author: authorMatch ? authorMatch[1] : undefined,
        points: scoreMatch ? Number.parseInt(scoreMatch[1], 10) : undefined,
        comments: commentsMatch ? Number.parseInt(commentsMatch[1], 10) : undefined,
      });
    }

    return { source: "hackernews", label: "Hacker News", url, articles };
  } catch (e) {
    return {
      source: "hackernews", label: "Hacker News", url,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Zenn ────────────────────────────────────────────────────────────────────
interface ZennArticle {
  slug: string;
  title: string;
  path: string;
  liked_count: number;
  user?: { username: string };
}

async function scrapeZenn(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const url = "https://zenn.dev/";
  try {
    const data = await fetchJson<{ articles: ZennArticle[] }>(
      "https://zenn.dev/api/articles?order=trending&count=30",
    );
    const articles: Article[] = [];
    for (const item of data.articles ?? []) {
      if (!isAIRelated(item.title, keywords)) continue;
      articles.push({
        source: "zenn",
        title: item.title,
        url: `https://zenn.dev${item.path}`,
        author: item.user?.username,
        points: item.liked_count,
      });
      if (articles.length >= limit) break;
    }
    return { source: "zenn", label: "Zenn", url, articles };
  } catch (e) {
    return {
      source: "zenn", label: "Zenn", url,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── DEV Community ────────────────────────────────────────────────────────────
interface DevToArticle {
  id: number;
  title: string;
  url: string;
  tag_list: string[];
  user: { username: string };
  public_reactions_count: number;
  comments_count: number;
}

async function scrapeDevTo(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const url = "https://dev.to/";
  try {
    // Fetch top articles and AI-tagged articles in parallel
    const [top, tagged] = await Promise.all([
      fetchJson<DevToArticle[]>("https://dev.to/api/articles?per_page=30&top=1"),
      fetchJson<DevToArticle[]>("https://dev.to/api/articles?per_page=30&tag=ai"),
    ]);

    const seen = new Set<string>();
    const articles: Article[] = [];
    for (const item of [...top, ...tagged]) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      const haystack = `${item.title} ${item.tag_list.join(" ")}`;
      if (!isAIRelated(haystack, keywords)) continue;
      articles.push({
        source: "devto",
        title: item.title,
        url: item.url,
        author: item.user?.username,
        points: item.public_reactions_count,
        comments: item.comments_count,
        tags: item.tag_list.length > 0 ? item.tag_list : undefined,
      });
      if (articles.length >= limit) break;
    }
    return { source: "devto", label: "DEV Community", url, articles };
  } catch (e) {
    return {
      source: "devto", label: "DEV Community", url,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Qiita ────────────────────────────────────────────────────────────────────
interface QiitaArticle {
  id: string;
  title: string;
  url: string;
  tags: Array<{ name: string }>;
  user: { id: string };
  likes_count: number;
  comments_count: number;
  body?: string;
}

async function scrapeQiita(
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  const url = "https://qiita.com/";
  try {
    // Search for AI-related articles
    const queries = ["AI", "LLM", "機械学習", "人工知能"];
    const seen = new Set<string>();
    const articles: Article[] = [];

    for (const q of queries) {
      if (articles.length >= limit) break;
      const items = await fetchJson<QiitaArticle[]>(
        `https://qiita.com/api/v2/items?per_page=10&query=${encodeURIComponent(`tag:${q}`)}`,
      );
      for (const item of items) {
        if (seen.has(item.url) || articles.length >= limit) continue;
        seen.add(item.url);
        const haystack = `${item.title} ${item.tags.map((t) => t.name).join(" ")}`;
        if (!isAIRelated(haystack, keywords)) continue;
        articles.push({
          source: "qiita",
          title: item.title,
          url: item.url,
          author: item.user?.id,
          points: item.likes_count,
          comments: item.comments_count,
          tags: item.tags.map((t) => t.name),
        });
      }
    }
    return { source: "qiita", label: "Qiita", url, articles };
  } catch (e) {
    return {
      source: "qiita", label: "Qiita", url,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const config = loadConfig();
  const { aiKeywords, maxItemsPerSource } = config;

  const settled = await Promise.allSettled([
    scrapeHackerNews(aiKeywords, maxItemsPerSource),
    scrapeZenn(aiKeywords, maxItemsPerSource),
    scrapeDevTo(aiKeywords, maxItemsPerSource),
    scrapeQiita(aiKeywords, maxItemsPerSource),
  ]);

  const scraped: SourceResult[] = settled
    .filter((s): s is PromiseFulfilledResult<SourceResult> => s.status === "fulfilled")
    .map((s) => s.value);

  // Fetch body text for each article sequentially to avoid overloading
  const enriched: SourceResult[] = [];
  for (const result of scraped) {
    const articlesWithBody: Article[] = [];
    for (const article of result.articles) {
      let bodyText = "";
      try {
        bodyText = await fetchBodyText(article.url);
      } catch {
        // skip on error
      }
      articlesWithBody.push({ ...article, bodyText });
    }
    enriched.push({ ...result, articles: articlesWithBody });
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
