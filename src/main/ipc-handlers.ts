import { ipcMain, BrowserWindow, desktopCapturer } from 'electron';
import {
  ApproveControllerSchema,
  ConnectPinSchema,
  SetApiKeySchema,
  SetSignalingUrlSchema,
  SetPreferredProviderSchema,
  LocalWorkflowSchema,
} from '../shared/schemas.js';
import {
  hasApiKey,
  setApiKey,
  getSignalingUrl,
  setSignalingUrl,
  getPreferredProvider,
  setPreferredProvider,
  listWorkflows,
  saveWorkflow,
  deleteWorkflow,
} from './storage.js';
import { SignalingClient } from './signaling-client.js';
import { launchBrowser, closeBrowser, getCaptureMetadata } from './browser-manager.js';

let signalingClient: SignalingClient | null = null;

function getOrCreateClient(win: BrowserWindow): SignalingClient {
  if (!signalingClient) signalingClient = new SignalingClient(win);
  return signalingClient;
}

function destroyClient() {
  signalingClient?.disconnect();
  signalingClient = null;
}

export function registerIpcHandlers(win: BrowserWindow) {

  // ── Debug logging from renderer/preload → terminal ────────────────────────
  ipcMain.on('debug:log', (_e, msg: string) => console.log(msg));

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle('settings:hasApiKey', async (_e, provider: unknown) => {
    const { provider: p } = SetApiKeySchema.pick({ provider: true }).parse({ provider });
    return hasApiKey(p);
  });

  ipcMain.handle('settings:setApiKey', async (_e, provider: unknown, value: unknown) => {
    const parsed = SetApiKeySchema.parse({ provider, value });
    setApiKey(parsed.provider, parsed.value);
  });

  ipcMain.handle('settings:getSignalingUrl', async () => getSignalingUrl());

  ipcMain.handle('settings:setSignalingUrl', async (_e, url: unknown) => {
    const { url: u } = SetSignalingUrlSchema.parse({ url });
    setSignalingUrl(u);
  });

  ipcMain.handle('settings:getPreferredProvider', async () => getPreferredProvider());

  ipcMain.handle('settings:setPreferredProvider', async (_e, provider: unknown) => {
    const { provider: p } = SetPreferredProviderSchema.parse({ provider });
    setPreferredProvider(p);
  });

  // ── Workflows ─────────────────────────────────────────────────────────────

  ipcMain.handle('workflows:list', async () => listWorkflows());

  ipcMain.handle('workflows:save', async (_e, workflow: unknown) => {
    saveWorkflow(LocalWorkflowSchema.parse(workflow));
  });

  ipcMain.handle('workflows:delete', async (_e, workflowId: unknown) => {
    if (typeof workflowId !== 'string' || !workflowId) throw new Error('Invalid workflowId');
    deleteWorkflow(workflowId);
  });

  // ── Host ──────────────────────────────────────────────────────────────────

  ipcMain.handle('host:start', async () => {
    destroyClient();
    const client = getOrCreateClient(win);
    const url = getSignalingUrl();
    try {
      await client.startHost(url);
    } catch (err) {
      // signaling-client.ts calls pushError before throwing in known paths,
      // but guard here in case an unexpected error escapes without notifying.
      const msg = err instanceof Error ? err.message : String(err);
      console.log('[host:start] failed:', msg);
      // Ensure the renderer always sees the error regardless of where it throws
      if (!win.isDestroyed()) win.webContents.send('app:error', msg);
    }
  });

  ipcMain.handle('host:stop', async () => {
    destroyClient();
    await closeBrowser();
  });

  ipcMain.handle('host:approveController', async (_e, controllerId: unknown) => {
    const { controllerId: id } = ApproveControllerSchema.parse({ controllerId });
    signalingClient?.approveController(id);
  });

  ipcMain.handle('host:rejectController', async (_e, controllerId: unknown) => {
    const { controllerId: id } = ApproveControllerSchema.parse({ controllerId });
    signalingClient?.rejectController(id);
  });

  // ── Controller ────────────────────────────────────────────────────────────

  ipcMain.handle('controller:connect', async (_e, pin: unknown) => {
    const { pin: p } = ConnectPinSchema.parse({ pin });
    destroyClient();
    const client = getOrCreateClient(win);
    const url = getSignalingUrl();
    try {
      await client.connectAsController(url, p);
    } catch (err) {
      // pushError already sent to renderer; suppress Electron's unhandled log
      console.log('[controller:connect] failed:', (err as Error).message);
    }
  });

  ipcMain.handle('controller:disconnect', async () => {
    destroyClient();
  });

  // ── Browser ───────────────────────────────────────────────────────────────

  ipcMain.handle('browser:launch', async () => {
    const title = await launchBrowser();
    // Push capture metadata to renderer after launch
    const meta = getCaptureMetadata();
    if (meta) win.webContents.send('browser:captureMetadata', meta);
    return title;
  });

  ipcMain.handle('browser:close', async () => {
    await closeBrowser();
  });

  ipcMain.handle('browser:getSources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name }));
  });

  ipcMain.handle('browser:resetProfile', async () => {
    await closeBrowser();
    console.log('[main] browser:resetProfile done');
  });

  // ── WebRTC Signal Relay ───────────────────────────────────────────────────

  ipcMain.handle('webrtc:sendSignal', async (_e, signal: unknown) => {
    const t = (signal as any)?.type ?? '?';
    const role = signalingClient?.getRole();
    console.log(`[ipc] webrtc:sendSignal role=${role ?? '(no client)'}, type=${t}`);
    // Only relay when a client exists and has a valid role
    if (signalingClient && (role === 'host' || role === 'controller')) {
      signalingClient.sendSignal(role, signal);
    }
  });
}
