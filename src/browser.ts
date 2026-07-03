import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const RETRYABLE_ERROR = /ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE/;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

export type BrowserHandle = Readonly<{
  browser: Browser;
  context: BrowserContext;
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
}>;

export async function launchBrowser(): Promise<BrowserHandle> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;
  const proxy = proxyServer ? { server: proxyServer } : undefined;
  // TLS-intercepting proxies can choke on Chrome's oversized post-quantum
  // ClientHello (X25519MLKEM768), causing the handshake to be reset.
  const args = proxyServer
    ? ["--ignore-certificate-errors", "--disable-features=PostQuantumKeyAgreementEnabled"]
    : undefined;
  const browser = await chromium.launch({ headless: true, executablePath, proxy, args });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1366, height: 900 },
    ignoreHTTPSErrors: true,
  });
  context.setDefaultNavigationTimeout(30_000);

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

export async function gotoWithRetry(
  page: Page,
  url: string,
  options: Parameters<Page["goto"]>[1] = {},
  retries = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await page.goto(url, options);
      return;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (attempt === retries || !RETRYABLE_ERROR.test(message)) {
        throw e;
      }
    }
  }
}
