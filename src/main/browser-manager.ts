import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';

export const BROWSER_TITLE = 'RemCon Host Browser';

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

export async function launchBrowser(startUrl = 'https://www.google.com'): Promise<string> {
  if (browser) {
    console.log('[browser] Playwright already running, reusing');
    return BROWSER_TITLE;
  }

  browser = await chromium.launch({
    headless: false,
    args: [
      '--window-size=1280,800',
      '--window-position=100,100',
      `--window-name=${BROWSER_TITLE}`,
    ],
  });

  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  page = await context.newPage();

  // Set a unique title so desktopCapturer can find this window
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
  // Set a unique title so desktopCapturer can identify this window
  await page.evaluate(`document.title = ${JSON.stringify(BROWSER_TITLE)}`);

  console.log('[browser] Playwright Chromium launched');
  return BROWSER_TITLE;
}

export async function closeBrowser(): Promise<void> {
  try {
    await context?.close();
    await browser?.close();
  } catch {
    // ignore close errors
  }
  browser = null;
  context = null;
  page = null;
  console.log('[browser] Playwright Chromium closed');
}

export function getPage(): Page | null { return page; }
export function isBrowserRunning(): boolean { return browser !== null; }

export function getCaptureMetadata() {
  if (!page) return null;
  const vp = page.viewportSize();
  return {
    viewportWidth: vp?.width ?? 1280,
    viewportHeight: vp?.height ?? 800,
    captureWidth: vp?.width ?? 1280,
    captureHeight: vp?.height ?? 800,
    deviceScaleFactor: 1,
    contentRect: { x: 0, y: 0, width: vp?.width ?? 1280, height: vp?.height ?? 800 },
  };
}
