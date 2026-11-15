import type { Page } from "playwright";
import type { Article, SourceResult } from "../types.js";

const URL = "https://www.theneurondaily.com/";

// AI専門のニュースレターのためAIキーワード判定は行わず、トップの先頭記事(最新号)を返す。
export async function scrapeNeuron(page: Page, limit: number): Promise<SourceResult> {
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('a[href^="/p/"]', { timeout: 15_000 });

    const raw = await page.$$eval('a[href^="/p/"]', (links) => {
      const seen = new Set<string>();
      const out: { title: string; url: string; publishedAt?: string }[] = [];
      for (const a of links) {
        const href = a.getAttribute("href") ?? "";
        const abs = `https://www.theneurondaily.com${href.split("?")[0]}`;
        // 同じ記事へのリンクが画像用・テキスト用で複数あるため、見出しのあるものだけ採用する
        const title = (a.querySelector("h2")?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!title || seen.has(abs)) continue;
        seen.add(abs);
        const publishedAt = a.querySelector("time")?.getAttribute("datetime") ?? undefined;
        out.push({ title, url: abs, publishedAt });
      }
      return out;
    });

    const articles: Article[] = [];
    for (const item of raw.slice(0, limit)) {
      articles.push({ source: "neuron", ...item });
    }

    return { source: "neuron", label: "The Neuron", url: URL, articles };
  } catch (e) {
    return {
      source: "neuron",
      label: "The Neuron",
      url: URL,
      articles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
