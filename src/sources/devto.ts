import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";
import { isAIRelated } from "../config.js";

const URL = "https://dev.to/";

export async function scrapeDevTo(
  page: Page,
  keywords: ReadonlyArray<string>,
  limit: number,
): Promise<SourceResult> {
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article, .crayons-story", { timeout: 15_000 });

    const raw = await page.$$eval(
      "article a, .crayons-story a",
      (links) => {
        const out: { title: string; url: string; tags: string[] }[] = [];
        const seen = new Set<string>();
        for (const a of links) {
          const href = a.getAttribute("href") ?? "";
          if (!href || href.startsWith("#")) continue;
          // 絶対URL (https://dev.to/user/slug) と相対URL (/user/slug) の両方を許容
          const path = href.startsWith("https://dev.to")
            ? href.slice("https://dev.to".length)
            : href;
          if (!/^\/[^/]+\/[^/]+/.test(path)) continue;
          if (
            path.startsWith("/tag/") ||
            path.startsWith("/t/") ||
            path.startsWith("/about") ||
            path.startsWith("/enterprise") ||
            path.startsWith("/billboards") ||
            path.startsWith("/report-abuse") ||
            path.startsWith("/settings")
          ) {
            continue;
          }
          const title = (a.textContent ?? "").replace(/\s+/g, " ").trim();
          if (!title || title.length < 6) continue;
          const abs = (href.startsWith("http") ? href : `https://dev.to${href}`).split("#")[0];
          if (seen.has(abs)) continue;
          seen.add(abs);

          // 親要素から #ai のようなタグも取得
          const card = a.closest("article, .crayons-story");
          const tags = card
            ? Array.from(card.querySelectorAll('a[href^="/t/"]'))
                .map((t) => t.textContent?.replace("#", "").trim() ?? "")
                .filter((t) => t.length > 0)
            : [];

          out.push({ title, url: abs, tags });
        }
        return out;
      },
    );

    const articles: Article[] = [];
    for (const item of raw) {
      const haystack = `${item.title} ${item.tags.join(" ")}`;
      if (!isAIRelated(haystack, keywords)) continue;
      articles.push({
        source: "devto",
        title: item.title,
        url: item.url,
        tags: item.tags.length > 0 ? item.tags : undefined,
      });
      if (articles.length >= limit) break;
    }

    return {
      source: "devto",
      label: "DEV Community",
      url: URL,
      articles,
    };
  } catch (e) {
    return {
      source: "devto",
      label: "DEV Community",
      url: URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
