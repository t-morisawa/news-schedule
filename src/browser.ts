import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// このサンドボックス環境ではTLS再終端型のプロキシを経由する必要があるが、
// ChromiumのTLSスタック(ECH等)がこのプロキシと相性が悪く直接ナビゲーションが失敗するため、
// 全リクエストをNode.jsのfetch(プロキシ対応)で代行しレスポンスをそのままfulfillする。
process.env.NODE_USE_ENV_PROXY ??= "1";

const STRIPPED_RESPONSE_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

async function fulfillViaFetch(route: Route): Promise<void> {
  const request = route.request();
  const url = request.url();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return route.continue();
  }
  try {
    const headers = { ...request.headers() };
    delete headers["host"];
    delete headers["content-length"];
    const postData = request.postDataBuffer();
    const res = await fetch(url, {
      method: request.method(),
      headers,
      body: postData ? new Uint8Array(postData) : undefined,
      redirect: "follow",
    });
    const body = Buffer.from(await res.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders[key] = value;
    });
    await route.fulfill({ status: res.status, headers: responseHeaders, body });
  } catch {
    await route.abort();
  }
}

export type BrowserHandle = Readonly<{
  browser: Browser;
  context: BrowserContext;
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
}>;

export async function launchBrowser(): Promise<BrowserHandle> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  });
  context.setDefaultNavigationTimeout(30_000);
  await context.route("**/*", fulfillViaFetch);

  return {
    browser,
    context,
    newPage: () => context.newPage(),
    close: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}
