import {
  app,
  BrowserWindow,
  shell,
  nativeTheme,
  dialog,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { setMainWindow } from './ipc-handlers.js';
import { closeBrowser } from './browser-manager.js';
import { cancelAgentCommand } from './agent-executor.js';
import { cancelWorkflow } from './workflow-executor.js';

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

let settingsWindow: BrowserWindow | null = null;

export function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 700,
    resizable: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (isDev) {
    settingsWindow.loadURL('http://localhost:5173/#/settings');
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'settings' });
  }

  settingsWindow.once('ready-to-show', () => {
    settingsWindow?.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

app.whenReady().then(() => {
  const win = createWindow();
  setMainWindow(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      setMainWindow(newWin);
    }
  });

  // ── Auto Updater configuration ──
  autoUpdater.autoDownload = false; // Prompt user before downloading

  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Version ${info.version} of RemoteCtrl is available.`,
      detail: 'Would you like to download it now?',
      buttons: ['Download', 'Skip'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'The update has been successfully downloaded.',
      detail: 'Would you like to restart the application to apply the updates now?',
      buttons: ['Restart', 'Later'],
      defaultId: 0,
      cancelId: 1
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater Error:', err);
  });

  // Check for updates (only in production)
  if (!isDev) {
    autoUpdater.checkForUpdates();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Cancel any running agent/workflow and close the Playwright browser before quitting.
app.on('before-quit', async () => {
  cancelAgentCommand();
  cancelWorkflow();
  await closeBrowser().catch(() => { });
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
