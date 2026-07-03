import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";
import { isAIRelated } from "../config.js";
import { gotoWithRetry } from "../browser.js";

const URL = "https://zenn.dev/";

export async function scrapeZenn(
  page: Page,
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  try {
    await gotoWithRetry(page, URL, { waitUntil: "domcontentloaded" });
    // ZennトップページはSPA。記事カードはJS描画後に出るのでnetworkidleまで待つ。
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForSelector('a[href*="/articles/"]', { timeout: 15_000 });

    const raw = await page.$$eval('a[href*="/articles/"]', (links) => {
      const seen = new Set<string>();
      const out: { title: string; url: string }[] = [];
      for (const a of links) {
        const href = a.getAttribute("href") ?? "";
        if (!href.includes("/articles/")) continue;
        if (href.includes("/articles/explore")) continue;
        const title = (a.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!title || title.length < 4) continue;
        const abs = href.startsWith("http") ? href : `https://zenn.dev${href}`;
        if (seen.has(abs)) continue;
        seen.add(abs);
        out.push({ title, url: abs });
      }
      return out;
    });

    const articles: Article[] = [];
    for (const item of raw) {
      if (!isAIRelated(item.title, keywords)) continue;
      articles.push({
        source: "zenn",
        title: item.title,
        url: item.url,
      });
      if (articles.length >= limit) break;
    }

    return {
      source: "zenn",
      label: "Zenn",
      url: URL,
      articles,
    };
  } catch (e) {
    return {
      source: "zenn",
      label: "Zenn",
      url: URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
