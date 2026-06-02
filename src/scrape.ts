import { loadConfig } from "./config.js";
import { launchBrowser } from "./browser.js";
import { scrapeHackerNews } from "./sources/hackernews.js";
import { scrapeZenn } from "./sources/zenn.js";
import { scrapeDevTo } from "./sources/devto.js";
import { scrapeQiita } from "./sources/qiita.js";
import { scrapeReddit } from "./sources/reddit.js";
import type { Article, SourceResult } from "./types.js";
import type { Page } from "playwright";

async function fetchBodyText(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  return page.evaluate(() => {
    for (const sel of ["article", "main", "[class*='article']", "[class*='post']", "[class*='content']"]) {
      const el = document.querySelector(sel);
      if (el && (el.textContent?.length ?? 0) > 300) {
        return el.textContent!.replace(/\s+/g, " ").trim().slice(0, 4000);
      }
    }
    return document.body.textContent?.replace(/\s+/g, " ").trim().slice(0, 4000) ?? "";
  });
}

async function runWith<T>(newPage: () => Promise<Page>, fn: (p: Page) => Promise<T>): Promise<T> {
  const page = await newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const handle = await launchBrowser();

  try {
    // 並列スクレイピング
    const settled = await Promise.allSettled([
      runWith(handle.newPage, (p) => scrapeHackerNews(p, config.aiKeywords, config.maxItemsPerSource)),
      runWith(handle.newPage, (p) => scrapeZenn(p, config.aiKeywords, config.maxItemsPerSource)),
      runWith(handle.newPage, (p) => scrapeDevTo(p, config.aiKeywords, config.maxItemsPerSource)),
      runWith(handle.newPage, (p) => scrapeQiita(p, config.aiKeywords, config.maxItemsPerSource)),
      runWith(handle.newPage, (p) => scrapeReddit(p, config.aiKeywords, config.maxItemsPerSource)),
    ]);

    const scraped: SourceResult[] = settled
      .filter((s): s is PromiseFulfilledResult<SourceResult> => s.status === "fulfilled")
      .map((s) => s.value);

    // 各記事の本文を順番に取得
    const enriched: SourceResult[] = [];
    for (const r of scraped) {
      const articlesWithBody: Article[] = [];
      for (const article of r.articles) {
        let bodyText = "";
        try {
          bodyText = await runWith(handle.newPage, (p) => fetchBodyText(p, article.url));
        } catch {
          // skip on error
        }
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
  } finally {
    await handle.close();
  }
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
