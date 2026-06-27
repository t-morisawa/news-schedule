import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

export type BrowserHandle = Readonly<{
  browser: Browser;
  context: BrowserContext;
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
}>;

export async function launchBrowser(): Promise<BrowserHandle> {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/opt/pw-browsers/chromium-1217/chrome-linux64/chrome",
  });
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
