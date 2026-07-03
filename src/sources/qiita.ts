import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";
import { isAIRelated } from "../config.js";
import { gotoWithRetry } from "../browser.js";

const URL = "https://qiita.com/";

export async function scrapeQiita(
  page: Page,
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  try {
    await gotoWithRetry(page, URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('a[href*="/items/"]', { timeout: 15_000 });

    const raw = await page.$$eval('a[href*="/items/"]', (links) => {
      const seen = new Set<string>();
      const out: { title: string; url: string; tags: string[] }[] = [];
      for (const a of links) {
        const href = a.getAttribute("href") ?? "";
        // 個別記事のURLは "/<user>/items/<id>"
        if (!/\/items\/[a-zA-Z0-9]+/.test(href)) continue;
        const title = (a.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!title || title.length < 6) continue;
        const abs = href.startsWith("http") ? href : `https://qiita.com${href}`;
        if (seen.has(abs)) continue;
        seen.add(abs);

        const card = a.closest("article, [class*='Card'], [class*='card']");
        const tags = card
          ? Array.from(card.querySelectorAll('a[href*="/tags/"]'))
              .map((t) => t.textContent?.trim() ?? "")
              .filter((t) => t.length > 0)
          : [];

        out.push({ title, url: abs, tags });
      }
      return out;
    });

    const articles: Article[] = [];
    for (const item of raw) {
      const haystack = `${item.title} ${item.tags.join(" ")}`;
      if (!isAIRelated(haystack, keywords)) continue;
      articles.push({
        source: "qiita",
        title: item.title,
        url: item.url,
        tags: item.tags.length > 0 ? item.tags : undefined,
      });
      if (articles.length >= limit) break;
    }

    return {
      source: "qiita",
      label: "Qiita",
      url: URL,
      articles,
    };
  } catch (e) {
    return {
      source: "qiita",
      label: "Qiita",
      url: URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
