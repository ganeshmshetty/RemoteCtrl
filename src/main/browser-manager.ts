import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
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

// CDP port used in internal mode so Stagehand can connect via raw CDP.
// A port distinct from local Chrome (9222) to avoid conflicts.
const INTERNAL_CDP_PORT = 9223;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let pages: PageEntry[] = [];
let activePageEntry: PageEntry | null = null;
let notifyWindow: BrowserWindow | null = null;
/** Resolved ws:// debugger URL passed to Stagehand — populated on launch. */
let cdpWsUrl: string | null = null;

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

/**
 * Polls the Chrome DevTools HTTP endpoint until the browser exposes its
 * WebSocket debugger URL, then returns that ws:// URL.
 * Chrome's root path returns 404; /json/version has what we need.
 */
async function resolveCdpWsUrl(httpBase: string, maxWaitMs = 8000): Promise<string> {
  const versionUrl = `${httpBase}/json/version`;
  const deadline = Date.now() + maxWaitMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(versionUrl);
      if (resp.ok) {
        const data = await resp.json() as { webSocketDebuggerUrl?: string };
        if (data.webSocketDebuggerUrl) {
          console.log(`[browser] CDP WS endpoint resolved: ${data.webSocketDebuggerUrl}`);
          return data.webSocketDebuggerUrl;
        }
      }
    } catch (e) {
      lastErr = String(e);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`CDP endpoint ${versionUrl} not ready after ${maxWaitMs}ms. Last error: ${lastErr}`);
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
      // Resolve the actual ws:// debugger URL for Stagehand
      cdpWsUrl = await resolveCdpWsUrl('http://localhost:9222');
    } catch (err) {
      console.error('[browser] Failed to connect to local Chrome. Make sure it is running with --remote-debugging-port=9222', err);
      throw new Error('Failed to connect to local Chrome on port 9222.');
    }
  } else {
    console.log(`[browser] Launching internal visible browser on CDP port ${INTERNAL_CDP_PORT}...`);
    browser = await chromium.launch({
      headless: false,
      args: [
        `--remote-debugging-port=${INTERNAL_CDP_PORT}`,
        '--window-size=1280,800',
        '--window-position=100,100',
      ],
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    // Resolve the actual ws:// URL from the CDP HTTP endpoint
    cdpWsUrl = await resolveCdpWsUrl(`http://127.0.0.1:${INTERNAL_CDP_PORT}`);
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
  } catch {
    // ignore close errors
  }
  browser = null;
  context = null;
  cdpWsUrl = null;
  pages = [];
  activePageEntry = null;
  console.log('[browser] Playwright Chromium closed');
}

export function getPage(): Page | null { return activePageEntry?.page || null; }
export function isBrowserRunning(): boolean { return browser !== null; }

/**
 * Returns the raw CDP WebSocket URL Stagehand needs to connect to the browser.
 * Populated after launchBrowser() resolves by polling /json/version.
 */
export function getCdpUrl(): string | null {
  return cdpWsUrl;
}

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
