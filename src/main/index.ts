import {
  app,
  BrowserWindow,
  shell,
  nativeTheme,
  desktopCapturer,
  session,
} from 'electron';
import path from 'path';
import { registerIpcHandlers } from './ipc-handlers.js';

// __dirname is available natively in CJS (esbuild target: cjs)

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      // Security: strict process separation
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Needed for preload to work without issues in dev
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Force dark mode
  nativeTheme.themeSource = 'dark';

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

app.whenReady().then(() => {
  const win = createWindow();
  registerIpcHandlers(win);

  // ── Screen capture: modern Electron approach ────────────────────────────
  // Intercept getDisplayMedia() calls from the renderer and programmatically
  // select the Playwright browser window (or fall back to first screen).
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 0, height: 0 },
      });

      // Try to find the Playwright browser window
      const target =
        sources.find((s) => s.name.includes('RemCon Host Browser')) ??
        sources.find((s) => s.name.toLowerCase().includes('chromium')) ??
        sources.find((s) => s.name.toLowerCase().includes('chrome')) ??
        sources.find((s) => s.id.startsWith('screen:')) ??
        sources[0];

      if (target) {
        console.log(`[capture] Selected source: "${target.name}" (${target.id})`);
        callback({ video: target });
      } else {
        console.error('[capture] No sources found');
        callback({});
      }
    } catch (err) {
      console.error('[capture] setDisplayMediaRequestHandler error:', err);
      callback({});
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      registerIpcHandlers(newWin);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: block navigation away from the app
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const appUrl = isDev ? 'http://localhost:5173' : 'app://';
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
    }
  });
});

// mainWindow exported for use in other modules if needed
