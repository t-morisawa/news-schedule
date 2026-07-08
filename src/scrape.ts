import { loadConfig } from "./config.js";
import { launchBrowser } from "./browser.js";
import { scrapeHackerNews } from "./sources/hackernews.js";
import { scrapeZenn } from "./sources/zenn.js";
import { scrapeDevTo } from "./sources/devto.js";
import { scrapeQiita } from "./sources/qiita.js";
import type { Article, SourceResult } from "./types.js";
import type { Page } from "playwright";

async function fetchBodyText(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  return page.evaluate(() => {
    // textContentはscript/styleタグの中身もそのまま連結してしまう(例: dev.toの<article>内に
    // 埋め込まれたlocalStorage初期化スクリプト)ため、抽出前に除外したクローンから読み取る。
    // (page.evaluateに渡す関数内でconst宣言の関数を切り出すと、esbuildが注入する__name
    //  ヘルパーがブラウザ側の分離実行コンテキストに存在せずReferenceErrorになるため、
    //  ヘルパー関数化はせずインラインで処理する。)
    const candidates = ["article", "main", "[class*='article']", "[class*='post']", "[class*='content']"]
      .map((sel) => document.querySelector(sel))
      .filter((el): el is Element => el !== null);
    candidates.push(document.body);

    for (const el of candidates) {
      const clone = el.cloneNode(true) as Element;
      clone.querySelectorAll("script, style, noscript").forEach((n) => n.remove());
      const text = clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text.length > 300 || el === document.body) return text.slice(0, 4000);
    }
    return "";
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
    // 全リクエストを単一のNode fetch経由プロキシで中継しているため(browser.ts参照)、
    // 複数ソースを並列に開くと接続を奪い合い、waitForSelectorがタイムアウトしやすくなる。
    // そのため逐次実行にしてソースごとの取りこぼしを防ぐ。
    const tasks = [
      () => runWith(handle.newPage, (p) => scrapeHackerNews(p, config.aiKeywords, config.maxItemsPerSource)),
      () => runWith(handle.newPage, (p) => scrapeZenn(p, config.aiKeywords, config.maxItemsPerSource)),
      () => runWith(handle.newPage, (p) => scrapeDevTo(p, config.aiKeywords, config.maxItemsPerSource)),
      () => runWith(handle.newPage, (p) => scrapeQiita(p, config.aiKeywords, config.maxItemsPerSource)),
    ];
    const settled: PromiseSettledResult<SourceResult>[] = [];
    for (const task of tasks) {
      try {
        settled.push({ status: "fulfilled", value: await task() });
      } catch (e) {
        settled.push({ status: "rejected", reason: e });
      }
    }

    const scraped: SourceResult[] = settled
      .filter((s): s is PromiseFulfilledResult<SourceResult> => s.status === "fulfilled")
      .map((s) => s.value);

    // 各記事の本文を順番に取得
    const enriched: SourceResult[] = [];
    for (const r of scraped) {
      const articlesWithBody: Article[] = [];
      for (const article of r.articles) {
        let bodyText = "";
        // プロキシの一時的なDNS解決失敗などで極端に短い本文しか取れないことがある。
        // 間隔を空けて最大3回まで取り直す(即座の連続リトライだと同じ瞬間の障害に
        // 連続で当たりやすいため)。
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
          try {
            bodyText = await runWith(handle.newPage, (p) => fetchBodyText(p, article.url));
          } catch {
            bodyText = "";
          }
          if (bodyText.length >= 50) break;
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
