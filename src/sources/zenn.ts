import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";
import { isAIRelated } from "../config.js";

const URL = "https://zenn.dev/";

export async function scrapeZenn(
  page: Page,
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    // ZennトップページはSPA。記事カードのリンクが描画されるまで待つ。
    await page.waitForSelector('a[href*="/articles/"], a[class*="ArticleList"]', {
      timeout: 15_000,
    });

    const raw = await page.$$eval('a[href*="/articles/"]', (links) => {
      const seen = new Set<string>();
      const out: { title: string; url: string }[] = [];
      for (const a of links) {
        const href = a.getAttribute("href") ?? "";
        if (!href.includes("/articles/")) continue;
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
