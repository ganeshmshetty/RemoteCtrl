import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page, BrowserServer } from 'playwright';
import type { RemoteMousePayload, RemoteKeyboardPayload, CaptureMetadata, TabInfo } from '../shared/types.js';
import { startScreencast, stopScreencast } from './screencast.js';
import { getBrowserMode } from './storage.js';
import type { BrowserWindow } from 'electron';

export const BROWSER_TITLE = 'RemoteCtrl Host Browser';

interface PageEntry {
  id: string;
  page: Page;
  title: string;
}

let browserServer: BrowserServer | null = null;
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let pages: PageEntry[] = [];
let activePageEntry: PageEntry | null = null;
let notifyWindow: BrowserWindow | null = null;

export function setBrowserNotifyWindow(win: BrowserWindow) {
  notifyWindow = win;
}

function emitTabsChange() {
  if (notifyWindow && !notifyWindow.isDestroyed()) {
    notifyWindow.webContents.send('browser:tabsChange', getTabs());
  }
}

export function getTabs(): TabInfo[] {
  return pages.map(entry => ({
    id: entry.id,
    url: entry.page.url(),
    title: entry.title || 'Loading...',
    active: entry === activePageEntry,
  }));
}

export async function switchTab(tabId: string): Promise<void> {
  const targetEntry = pages.find(p => p.id === tabId);
  if (targetEntry && targetEntry !== activePageEntry) {
    activePageEntry = targetEntry;
    await activePageEntry.page.bringToFront();
    await startScreencast(activePageEntry.page);
    emitTabsChange();
  }
}

export async function goBack(): Promise<void> {
  if (activePageEntry) await activePageEntry.page.goBack().catch(() => {});
}

export async function goForward(): Promise<void> {
  if (activePageEntry) await activePageEntry.page.goForward().catch(() => {});
}

export async function reload(): Promise<void> {
  if (activePageEntry) await activePageEntry.page.reload().catch(() => {});
}

export async function navigate(url: string): Promise<void> {
  if (activePageEntry) {
    let targetUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      targetUrl = 'https://' + url;
    }
    await activePageEntry.page.goto(targetUrl).catch(() => {});
  }
}

export async function closeTab(tabId: string): Promise<void> {
  const targetEntry = pages.find(p => p.id === tabId);
  if (targetEntry) {
    await targetEntry.page.close().catch(() => {});
  }
}

function registerPage(p: Page) {
  const entry: PageEntry = { id: crypto.randomUUID(), page: p, title: 'Loading...' };
  pages.push(entry);

  p.on('close', async () => {
    pages = pages.filter(x => x !== entry);
    if (activePageEntry === entry) {
      activePageEntry = pages[pages.length - 1] || null;
      if (activePageEntry) {
        await activePageEntry.page.bringToFront();
        await startScreencast(activePageEntry.page);
      } else {
        await stopScreencast();
      }
    }
    emitTabsChange();
  });

  p.on('load', async () => {
    try { entry.title = await p.title(); } catch { }
    emitTabsChange();
  });
  
  p.title().then(t => { entry.title = t; emitTabsChange(); }).catch(() => {});

  return entry;
}

export async function launchBrowser(startUrl = 'https://www.google.com'): Promise<string> {
  if (browser) {
    console.log('[browser] Playwright already running, reusing');
    return BROWSER_TITLE;
  }

  const mode = getBrowserMode();

  if (mode === 'local_chrome') {
    try {
      console.log('[browser] Attempting to connect to Local Chrome on port 9222...');
      browser = await chromium.connectOverCDP('http://localhost:9222');
      // Use existing default context
      context = browser.contexts()[0];
      if (!context) {
         context = await browser.newContext();
      }
    } catch (err) {
      console.error('[browser] Failed to connect to local Chrome. Make sure it is running with --remote-debugging-port=9222', err);
      throw new Error('Failed to connect to local Chrome on port 9222.');
    }
  } else {
    console.log('[browser] Launching internal visible browser...');
    browserServer = await chromium.launchServer({
      headless: false,
      args: [
        '--window-size=1280,800',
        '--window-position=100,100',
      ],
    });
    browser = await chromium.connect(browserServer.wsEndpoint());
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
  }

  // Flag: true while launchBrowser is setting up the first page so that the
  // context.on('page') handler skips the fire-and-forget startScreencast call
  // for that initial page (it's explicitly awaited right after context.newPage()).
  let launchingInitialPage = false;

  context.on('page', (p: Page) => {
    const entry = registerPage(p);
    activePageEntry = entry;
    // Skip auto-start for the very first page — launchBrowser() awaits it
    // explicitly below to avoid a double-start race.
    if (!launchingInitialPage) {
      startScreencast(p).then(() => emitTabsChange());
    }
  });

  // Populate existing pages if connecting to a live browser
  for (const p of context.pages()) {
    registerPage(p);
  }

  if (pages.length === 0) {
    launchingInitialPage = true;
    await context.newPage();
    launchingInitialPage = false;
    // Explicitly await screencast start so CDP is ready before navigation.
    if (activePageEntry) {
      await startScreencast(activePageEntry.page);
      emitTabsChange();
    }
  } else {
    activePageEntry = pages[0];
    await activePageEntry.page.bringToFront();
    await startScreencast(activePageEntry.page);
    emitTabsChange();
  }

  if (activePageEntry) {
    await activePageEntry.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => { });
  }

  console.log(`[browser] Playwright connected in ${mode} mode`);
  return BROWSER_TITLE;
}

export async function closeBrowser(): Promise<void> {
  await stopScreencast();
  try {
    await context?.close();
    await browser?.close();
    await browserServer?.close();
  } catch {
    // ignore close errors
  }
  browserServer = null;
  browser = null;
  context = null;
  pages = [];
  activePageEntry = null;
  console.log('[browser] Playwright Chromium closed');
}

export function getPage(): Page | null { return activePageEntry?.page || null; }
export function isBrowserRunning(): boolean { return browser !== null; }
export function getCdpUrl(): string | null { return browserServer?.wsEndpoint() ?? null; }

export async function resetProfile(): Promise<void> {
  if (context) {
    await context.clearCookies();
  }
  if (activePageEntry) {
    await activePageEntry.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    }).catch(() => { });
  }
}

export function getCaptureMetadata() {
  if (!activePageEntry) return null;
  const vp = activePageEntry.page.viewportSize();
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
  if (!activePageEntry) return;
  const x = payload.xPercent * meta.viewportWidth;
  const y = payload.yPercent * meta.viewportHeight;

  if (payload.action === 'move') {
    await activePageEntry.page.mouse.move(x, y);
  } else if (payload.action === 'down') {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.down({ button: payload.button || 'left' });
  } else if (payload.action === 'up') {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.up({ button: payload.button || 'left' });
  } else if (payload.action === 'click') {
    await activePageEntry.page.mouse.click(x, y, { button: payload.button || 'left' });
  } else if (payload.action === 'scroll' && payload.deltaY) {
    await activePageEntry.page.mouse.move(x, y);
    await activePageEntry.page.mouse.wheel(0, payload.deltaY);
  }
}

export async function injectKeyboard(payload: RemoteKeyboardPayload) {
  if (!activePageEntry) return;
  if (payload.action === 'down') {
    await activePageEntry.page.keyboard.down(payload.key);
  } else if (payload.action === 'up') {
    await activePageEntry.page.keyboard.up(payload.key);
  } else if (payload.action === 'press') {
    await activePageEntry.page.keyboard.press(payload.key);
  }
}
