import { createServer } from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { isAIRelated } from "./config.js";

const AI_KEYWORDS = [
  "ai", "a.i.", "artificial intelligence", "machine learning", "ml",
  "deep learning", "llm", "large language model", "gpt", "chatgpt",
  "claude", "gemini", "anthropic", "openai", "copilot", "cursor",
  "agent", "agentic", "rag", "transformer", "diffusion", "stable diffusion",
  "embedding", "fine-tune", "fine tuning", "prompt", "mcp", "vector",
  "neural", "人工知能", "機械学習", "深層学習", "生成ai", "生成系ai",
  "言語モデル", "プロンプト", "エージェント",
];

const MAX_PER_SOURCE = 5;

function isAITopic(text: string): boolean {
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some((k) => lower.includes(k));
}

async function fetchHtml(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const caCert = readFileSync("/root/.ccr/ca-bundle.crt");
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;

    const fetchDirect = () => {
      const req = https.get(url, {
        ca: caCert,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
          "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            fetchHtml(res.headers.location as string).then(resolve).catch(reject);
          } else {
            resolve(body);
          }
        });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(20000, () => { req.destroy(new Error("timeout")); });
    };

    if (proxyUrl) {
      const proxyMatch = proxyUrl.match(/^https?:\/\/([^:]+):(\d+)/);
      if (proxyMatch) {
        const proxyHost = proxyMatch[1];
        const proxyPort = parseInt(proxyMatch[2], 10);
        const targetUrl = new URL(url);

        const connectReq = require("net").createConnection({ host: proxyHost, port: proxyPort }, () => {
          connectReq.write(`CONNECT ${targetUrl.hostname}:443 HTTP/1.1\r\nHost: ${targetUrl.hostname}:443\r\n\r\n`);

          connectReq.once("data", (d: Buffer) => {
            const response = d.toString();
            if (!response.includes("200")) {
              reject(new Error(`Proxy CONNECT failed: ${response.slice(0, 100)}`));
              return;
            }

            const tlsSocket = require("tls").connect({
              socket: connectReq,
              host: targetUrl.hostname,
              ca: caCert,
              rejectUnauthorized: true,
            });

            tlsSocket.on("secureConnect", () => {
              const path = targetUrl.pathname + (targetUrl.search || "");
              tlsSocket.write(
                `GET ${path} HTTP/1.1\r\n` +
                `Host: ${targetUrl.hostname}\r\n` +
                `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15\r\n` +
                `Accept-Language: ja-JP,ja;q=0.9,en;q=0.8\r\n` +
                `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\r\n` +
                `Connection: close\r\n\r\n`
              );

              const chunks: Buffer[] = [];
              tlsSocket.on("data", (chunk: Buffer) => chunks.push(chunk));
              tlsSocket.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf-8");
                const bodyStart = raw.indexOf("\r\n\r\n");
                const body = bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw;
                resolve(body);
              });
              tlsSocket.on("error", reject);
            });

            tlsSocket.on("error", reject);
          });
        });
        connectReq.on("error", reject);
        return;
      }
    }

    fetchDirect();
  });
}

async function fetchWithCurl(url: string): Promise<string> {
  const { execSync } = await import("node:child_process");
  const result = execSync(
    `curl -sS --cacert /root/.ccr/ca-bundle.crt -L -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15" --max-time 20 "${url}"`,
    { maxBuffer: 10 * 1024 * 1024 }
  );
  return result.toString("utf-8");
}

function extractText(html: string, selectors: string[]): string {
  let best = "";
  // Simple regex-based text extraction
  const noScript = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                       .replace(/<[^>]+>/g, " ")
                       .replace(/\s+/g, " ")
                       .trim();
  return noScript.slice(0, 4000);
}

async function scrapeHackerNews() {
  try {
    const html = await fetchWithCurl("https://news.ycombinator.com/");

    const articles: any[] = [];
    // Match HN story rows: <tr class="athing" id="NUM">
    const rowPattern = /<tr class="athing"[^>]*id="(\d+)"[\s\S]*?class="titleline"[^>]*><a href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    const subPattern = /class="score"[^>]*>(\d+) point/;
    const authorPattern = /class="hnuser"[^>]*>([^<]+)<\/a>/;
    const commentPattern = /(\d+)&nbsp;comment/;

    const rows = html.split('<tr class="athing submission"').slice(1);

    for (const row of rows) {
      const titleMatch = row.match(/class="titleline"[^>]*><a href="([^"]+)"[^>]*>([^<]+)<\/a>/);
      if (!titleMatch) continue;

      let url = titleMatch[1];
      const title = titleMatch[2].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();

      if (!isAITopic(title)) continue;

      if (!url.startsWith("http")) url = `https://news.ycombinator.com/${url}`;

      const idMatch = row.match(/id="(\d+)"/);
      const id = idMatch ? idMatch[1] : "";

      const subline = html.split(`id="${id}"`)[1] || "";
      const scoreMatch = subline.match(subPattern);
      const authorMatch = subline.match(authorPattern);
      const commentMatch = subline.match(commentPattern);

      articles.push({
        source: "hackernews",
        title,
        url,
        author: authorMatch ? authorMatch[1] : undefined,
        points: scoreMatch ? parseInt(scoreMatch[1], 10) : undefined,
        comments: commentMatch ? parseInt(commentMatch[1], 10) : undefined,
        bodyText: "",
      });

      if (articles.length >= MAX_PER_SOURCE) break;
    }

    return { label: "Hacker News", error: null, articles };
  } catch (e) {
    return { label: "Hacker News", error: String(e), articles: [] };
  }
}

async function scrapeZenn() {
  try {
    // Zenn has an API endpoint
    const json = await fetchWithCurl("https://zenn.dev/api/articles?order=latest&count=50");
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      // fallback to HTML scraping
      const html = await fetchWithCurl("https://zenn.dev/");
      const articles: any[] = [];
      const linkPattern = /href="(\/articles\/[^"]+)"[^>]*>[\s\S]*?<\/a>/g;
      const titlePattern = />([\s\S]{10,200}?)<\/(?:h2|h3|span|a)/;

      const matches = [...html.matchAll(/href="(\/articles\/([^"?]+))"[^>]*>([\s\S]{1,500}?)<\/a>/g)];
      const seen = new Set<string>();
      for (const m of matches) {
        const url = `https://zenn.dev${m[1]}`;
        if (seen.has(url)) continue;
        const rawText = m[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (rawText.length < 6) continue;
        if (!isAITopic(rawText)) continue;
        seen.add(url);
        articles.push({ source: "zenn", title: rawText.slice(0, 120), url, bodyText: "" });
        if (articles.length >= MAX_PER_SOURCE) break;
      }
      return { label: "Zenn", error: null, articles };
    }

    const articles: any[] = [];
    const items = parsed.articles || [];
    for (const item of items) {
      const title = item.title || "";
      const topics = (item.topics || []).map((t: any) => t.name || "").join(" ");
      if (!isAITopic(title + " " + topics)) continue;

      articles.push({
        source: "zenn",
        title,
        url: `https://zenn.dev${item.path}`,
        author: item.user?.username,
        bodyText: item.body_letters_count > 0 ? "" : "",
      });
      if (articles.length >= MAX_PER_SOURCE) break;
    }

    return { label: "Zenn", error: null, articles };
  } catch (e) {
    return { label: "Zenn", error: String(e), articles: [] };
  }
}

async function scrapeDevTo() {
  try {
    const json = await fetchWithCurl("https://dev.to/api/articles?per_page=50&top=1");
    const items = JSON.parse(json);
    const articles: any[] = [];

    for (const item of items) {
      const haystack = `${item.title} ${(item.tag_list || []).join(" ")}`;
      if (!isAITopic(haystack)) continue;

      articles.push({
        source: "devto",
        title: item.title,
        url: item.url || `https://dev.to/${item.slug}`,
        author: item.user?.username,
        tags: item.tag_list,
        bodyText: "",
      });
      if (articles.length >= MAX_PER_SOURCE) break;
    }

    return { label: "DEV Community", error: null, articles };
  } catch (e) {
    return { label: "DEV Community", error: String(e), articles: [] };
  }
}

async function scrapeQiita() {
  try {
    const token = process.env.QIITA_TOKEN;
    const headers = token ? `--header "Authorization: Bearer ${token}"` : "";
    const json = await fetchWithCurl(`https://qiita.com/api/v2/items?page=1&per_page=50&query=tag%3AML+OR+tag%3Amachine-learning+OR+tag%3Aai+OR+tag%3ALLM+OR+tag%3AGenerativeAI`);
    const items = JSON.parse(json);
    const articles: any[] = [];

    for (const item of items) {
      const tags = (item.tags || []).map((t: any) => t.name || "").join(" ");
      const haystack = `${item.title} ${tags}`;
      if (!isAITopic(haystack)) continue;

      articles.push({
        source: "qiita",
        title: item.title,
        url: item.url,
        author: item.user?.id,
        tags: (item.tags || []).map((t: any) => t.name),
        bodyText: (item.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000),
      });
      if (articles.length >= MAX_PER_SOURCE) break;
    }

    // If API returns error or no results, try different search
    if (articles.length === 0) {
      const json2 = await fetchWithCurl("https://qiita.com/api/v2/items?page=1&per_page=50&query=AI");
      const items2 = JSON.parse(json2);
      for (const item of items2) {
        const tags = (item.tags || []).map((t: any) => t.name || "").join(" ");
        const haystack = `${item.title} ${tags}`;
        if (!isAITopic(haystack)) continue;
        articles.push({
          source: "qiita",
          title: item.title,
          url: item.url,
          author: item.user?.id,
          tags: (item.tags || []).map((t: any) => t.name),
          bodyText: (item.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000),
        });
        if (articles.length >= MAX_PER_SOURCE) break;
      }
    }

    return { label: "Qiita", error: null, articles };
  } catch (e) {
    return { label: "Qiita", error: String(e), articles: [] };
  }
}

async function fetchBodyText(url: string): Promise<string> {
  try {
    const html = await fetchWithCurl(url);
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch {
    return "";
  }
}

async function main() {
  const [hn, zenn, devto, qiita] = await Promise.all([
    scrapeHackerNews(),
    scrapeZenn(),
    scrapeDevTo(),
    scrapeQiita(),
  ]);

  const sources = [hn, zenn, devto, qiita];

  // Fetch body text for articles missing it (except Qiita which already includes it)
  for (const src of sources) {
    for (const article of src.articles) {
      if (!article.bodyText && article.url) {
        // Only fetch for non-Qiita (Qiita already has body from API)
        if (article.source !== "qiita") {
          article.bodyText = await fetchBodyText(article.url);
        }
      }
    }
  }

  const output = {
    timestamp: new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
    sources: sources.map((r) => ({
      label: r.label,
      error: r.error,
      articles: r.articles,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error("[fatal]", e);
  process.exit(1);
});
