import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { launchBrowser } from "./browser.js";
import { scrapeHackerNews } from "./sources/hackernews.js";
import { scrapeZenn } from "./sources/zenn.js";
import { scrapeDevTo } from "./sources/devto.js";
import { scrapeQiita } from "./sources/qiita.js";
import { summarizeAll } from "./summarize.js";
import { buildSummary, notifyAll } from "./notify.js";
import type { Article, SourceResult } from "./types.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(`[start] dryRun=${config.dryRun} max=${config.maxItemsPerSource}`);

  const handle = await launchBrowser();
  let results: SourceResult[] = [];

  try {
    // ソースごとに別ページを起動して並列収集
    const tasks = [
      runWith(handle.newPage, (p) =>
        scrapeHackerNews(p, config.aiKeywords, config.maxItemsPerSource),
      ),
      runWith(handle.newPage, (p) =>
        scrapeZenn(p, config.aiKeywords, config.maxItemsPerSource),
      ),
      runWith(handle.newPage, (p) =>
        scrapeDevTo(p, config.aiKeywords, config.maxItemsPerSource),
      ),
      runWith(handle.newPage, (p) =>
        scrapeQiita(p, config.aiKeywords, config.maxItemsPerSource),
      ),
    ];

    const settled = await Promise.allSettled(tasks);
    for (const s of settled) {
      if (s.status === "fulfilled") {
        results.push(s.value);
      } else {
        console.error("[scrape error]", s.reason);
      }
    }

    // 記事を要約（ANTHROPIC_API_KEYが設定されている場合のみ）
    if (config.anthropicApiKey) {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      const allArticles: Article[] = results.flatMap((r) => [...r.articles]);
      console.log(`[summarize] ${allArticles.length}件の記事を要約します...`);
      const summaries = await summarizeAll(handle.newPage, allArticles, client);

      results = results.map((r) => ({
        ...r,
        articles: r.articles.map((a) => ({
          ...a,
          summary: summaries.get(a.url),
        })),
      }));
    } else {
      console.log("[summarize] ANTHROPIC_API_KEYが未設定のためスキップします");
    }
  } finally {
    await handle.close();
  }

  const summary = buildSummary(results);
  console.log("\n--- summary ---\n");
  console.log(summary);

  if (config.dryRun) {
    console.log("\n[dry-run] webhookには送信しませんでした");
    return;
  }

  try {
    await notifyAll(
      {
        discordWebhookUrl: config.discordWebhookUrl,
        slackWebhookUrl: config.slackWebhookUrl,
      },
      summary,
    );
    console.log("[done] webhookへ送信完了");
  } catch (e) {
    console.error("[notify error]", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

async function runWith<T>(
  newPage: () => Promise<import("playwright").Page>,
  fn: (p: import("playwright").Page) => Promise<T>,
): Promise<T> {
  const page = await newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
