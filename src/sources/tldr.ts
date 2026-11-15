import type { Page } from "playwright";
import type { SourceResult } from "../types.js";

const FEED_URL = "https://tldr.tech/api/rss/ai";
const SITE_URL = "https://tldr.tech/ai";

// AI専門のニュースレターのためAIキーワード判定は行わず、RSS先頭(最新号)を1件だけ返す。
// 1号に複数記事が載っており汎用の本文抽出(最初の<article>)だと1記事分しか取れないため、
// 本文もここで号ページ全体から取得する。
export async function scrapeTldr(page: Page): Promise<SourceResult> {
  try {
    const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`RSS取得失敗: HTTP ${res.status}`);
    const xml = await res.text();

    const item = /<item>([\s\S]*?)<\/item>/.exec(xml)?.[1];
    if (!item) throw new Error("RSSに記事が見つかりません");
    const url = /<link>([^<]+)<\/link>/.exec(item)?.[1]?.trim();
    if (!url) throw new Error("RSSの先頭記事にlinkがありません");
    const title =
      /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(item)?.[1]?.trim() ??
      /<title>([^<]*)<\/title>/.exec(item)?.[1]?.trim() ??
      url;
    const publishedAt = /<pubDate>([^<]+)<\/pubDate>/.exec(item)?.[1]?.trim();

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article", { timeout: 15_000 });
    const bodyText = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as Element;
      clone.querySelectorAll("script, style, noscript, nav, header, footer").forEach((n) => n.remove());
      return (clone.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 8000);
    });

    return {
      source: "tldr",
      label: "TLDR AI",
      url: SITE_URL,
      articles: [{ source: "tldr", title, url, publishedAt, bodyText }],
    };
  } catch (e) {
    return {
      source: "tldr",
      label: "TLDR AI",
      url: SITE_URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
