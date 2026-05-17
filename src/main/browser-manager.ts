import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { RemoteMousePayload, RemoteKeyboardPayload, CaptureMetadata } from '../shared/types.js';

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

export async function injectMouse(payload: RemoteMousePayload, meta: CaptureMetadata) {
  if (!page) return;
  const x = payload.xPercent * meta.viewportWidth;
  const y = payload.yPercent * meta.viewportHeight;

  if (payload.action === 'move') {
    await page.mouse.move(x, y);
  } else if (payload.action === 'down') {
    await page.mouse.move(x, y);
    await page.mouse.down({ button: payload.button || 'left' });
  } else if (payload.action === 'up') {
    await page.mouse.move(x, y);
    await page.mouse.up({ button: payload.button || 'left' });
  } else if (payload.action === 'click') {
    await page.mouse.click(x, y, { button: payload.button || 'left' });
  } else if (payload.action === 'scroll' && payload.deltaY) {
    await page.mouse.wheel(0, payload.deltaY);
  }
}

export async function injectKeyboard(payload: RemoteKeyboardPayload) {
  if (!page) return;
  if (payload.action === 'down') {
    await page.keyboard.down(payload.key);
  } else if (payload.action === 'up') {
    await page.keyboard.up(payload.key);
  } else if (payload.action === 'press') {
    await page.keyboard.press(payload.key);
  }
}
