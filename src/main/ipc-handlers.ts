import { ipcMain, BrowserWindow, desktopCapturer, app } from 'electron';
import {
  ApproveControllerSchema,
  ConnectPinSchema,
  SetApiKeySchema,
  SetSignalingUrlSchema,
  SetPreferredProviderSchema,
  LocalWorkflowSchema,
  RemoteMousePayloadSchema,
  RemoteKeyboardPayloadSchema,
  AgentPromptSchema,
  AgentWorkflowBatchSchema,
} from '../shared/schemas.js';
import {
  hasApiKey,
  setApiKey,
  getSignalingUrl,
  setSignalingUrl,
  getPreferredProvider,
  setPreferredProvider,
  getPreferredModel,
  setPreferredModel,
  getBrowserMode,
  setBrowserMode,
  listWorkflows,
  saveWorkflow,
  deleteWorkflow,
  getApiKey,
  getHeadlessMode,
  setHeadlessMode,
  getModelsList,
  saveModelsList,
} from './storage.js';
import { SignalingClient } from './signaling-client.js';
import { launchBrowser, closeBrowser, getCaptureMetadata, injectMouse, injectKeyboard, resetProfile } from './browser-manager.js';
import { runAgentCommand, cancelAgentCommand, isAgentRunning, setAgentPaused } from './agent-executor.js';
import { runWorkflow, cancelWorkflow, isWorkflowRunning, setWorkflowPaused } from './workflow-executor.js';
import { submitCheckpointResponse } from './human-checkpoint.js';
import { setScreencastWindow } from './screencast.js';
import { setBrowserNotifyWindow, getTabs, switchTab, goBack, goForward, reload, navigate, closeTab, newTab } from './browser-manager.js';
import type { AgentWorkflowBatchPayload } from '../shared/types.js';

let signalingClient: SignalingClient | null = null;
let currentWindow: BrowserWindow | null = null;
let isRegistered = false;

export function setMainWindow(win: BrowserWindow) {
  currentWindow = win;
  setScreencastWindow(win);
  setBrowserNotifyWindow(win);
  if (!isRegistered) {
    registerIpcHandlers();
    isRegistered = true;
  }
}

export function getMainWindow() { return currentWindow; }

function getOrCreateClient(): SignalingClient {
  if (!signalingClient) {
    if (!currentWindow) throw new Error("No main window set in ipc-handlers");
    signalingClient = new SignalingClient(currentWindow);
  }
  return signalingClient;
}

function destroyClient() {
  if (signalingClient) {
    signalingClient.disconnect();
  }
  signalingClient = null;
}

function registerIpcHandlers() {

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
    const p = SetPreferredProviderSchema.parse({ provider });
    setPreferredProvider(p.provider);
  });

  ipcMain.handle('settings:getPreferredModel', async () => getPreferredModel());

  ipcMain.handle('settings:setPreferredModel', async (_e, model: unknown) => {
    if (typeof model === 'string') {
      setPreferredModel(model);
    }
  });

  ipcMain.handle('settings:fetchModels', async (_e, provider: unknown) => {
    if (typeof provider !== 'string') return [];
    
    let url = '';
    const key = getApiKey(provider as any);
    if (!key && provider !== 'openrouter') return []; // OpenRouter has public models, but passing key is better
    
    let headers: Record<string, string> = {};
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    switch (provider) {
      case 'openai':
        url = 'https://api.openai.com/v1/models';
        break;
      case 'groq':
        url = 'https://api.groq.com/openai/v1/models';
        break;
      case 'deepseek':
        url = 'https://api.deepseek.com/models';
        break;
      case 'nebius':
        url = 'https://api.tokenfactory.nebius.com/v1/models';
        break;
      case 'openrouter':
        url = 'https://openrouter.ai/api/v1/models';
        headers['HTTP-Referer'] = 'https://github.com/ganeshmshetty/RemCtrl';
        headers['X-Title'] = 'RemoteCtrl';
        break;
      default:
        return [];
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return [];
      const data = await res.json() as any;
      if (data && data.data && Array.isArray(data.data)) {
        // For OpenRouter, filter to only chat/text models (exclude embedding, image, moderation)
        const skipSuffixes = ['embed', 'embedding', 'moderation', 'image', 'vision', 'whisper', 'tts', 'dall-e'];
        const models = data.data
          .map((m: any) => m.id as string)
          .filter(Boolean)
          .filter((id: string) => {
            const lower = id.toLowerCase();
            return !skipSuffixes.some(suffix => lower.includes(suffix));
          });
        if (models.length > 0) {
          saveModelsList(provider as any, models);
        }
        return models;
      }
      return [];
    } catch (e) {
      console.error('Failed to fetch models', e);
      return [];
    }
  });

  ipcMain.handle('settings:getAvailableModels', async (_e, provider: unknown) => {
    if (typeof provider === 'string') {
      return getModelsList(provider as any);
    }
    return [];
  });

  ipcMain.handle('settings:getBrowserMode', async () => getBrowserMode());

  ipcMain.handle('settings:setBrowserMode', async (_e, mode: unknown) => {
    setBrowserMode(mode as any);
  });

  ipcMain.handle('settings:getHeadlessMode', async () => getHeadlessMode());

  ipcMain.handle('settings:setHeadlessMode', async (_e, headless: unknown) => {
    setHeadlessMode(Boolean(headless));
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

  // ── WebRTC Signaling Connection ───────────────────────────────────────────

  ipcMain.handle('host:start', async () => {
    destroyClient();
    const client = getOrCreateClient();
    const url = getSignalingUrl();
    try {
      await client.startHost(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('app:error', msg);
    }
    return { ok: true };
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

  ipcMain.handle('controller:connect', async (_e, pin: string) => {
    const parsed = ConnectPinSchema.parse({ pin });
    destroyClient();
    const client = getOrCreateClient();
    const url = getSignalingUrl();
    try {
      await client.connectAsController(url, parsed.pin);
    } catch (err) {
      // Error already sent to renderer by pushError
    }
    return { ok: true };
  });

  ipcMain.handle('controller:disconnect', async () => {
    destroyClient();
  });

  // ── Browser Management ────────────────────────────────────────────────────

  ipcMain.handle('browser:launch', async (_e, startUrl?: unknown) => {
    try {
      const title = await launchBrowser(
        typeof startUrl === 'string' ? startUrl : undefined,
      );
      return title;
    } catch (err) {
      console.error('[ipc] Failed to launch browser:', err);
      throw err;
    }
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

  ipcMain.handle('browser:injectMouse', async (_e, payload: unknown) => {
    const parsed = RemoteMousePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.error('[ipc] Invalid mouse payload:', parsed.error);
      return;
    }
    const meta = getCaptureMetadata();
    if (meta) {
      await injectMouse(parsed.data, meta);
    }
  });

  ipcMain.handle('browser:injectKeyboard', async (_e, payload: unknown) => {
    const parsed = RemoteKeyboardPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      console.error('[ipc] Invalid keyboard payload:', parsed.error);
      return;
    }
    await injectKeyboard(parsed.data);
  });

  ipcMain.handle('browser:resetProfile', async () => {
    await resetProfile();
    return { ok: true };
  });

  ipcMain.handle('browser:getTabs', async () => {
    return getTabs();
  });

  ipcMain.handle('browser:switchTab', async (_e, tabId: unknown) => {
    if (typeof tabId !== 'string' || !tabId) {
      return { ok: false, error: 'Invalid tabId: must be a non-empty string' };
    }
    await switchTab(tabId);
    return { ok: true };
  });

  ipcMain.handle('browser:goBack', async () => {
    await goBack();
    return { ok: true };
  });

  ipcMain.handle('browser:goForward', async () => {
    await goForward();
    return { ok: true };
  });

  ipcMain.handle('browser:reload', async () => {
    await reload();
    return { ok: true };
  });

  ipcMain.handle('browser:navigate', async (_e, url: unknown) => {
    if (typeof url === 'string' && url) {
      await navigate(url);
    }
    return { ok: true };
  });

  ipcMain.handle('browser:closeTab', async (_e, tabId: unknown) => {
    if (typeof tabId === 'string' && tabId) {
      await closeTab(tabId);
    }
    return { ok: true };
  });

  ipcMain.handle('browser:newTab', async () => {
    await newTab();
    return { ok: true };
  });

  // ── WebRTC ─────────────────────────────────────────────────────────────────

  // ── Agent Execution ───────────────────────────────────────────────────────

  ipcMain.handle('browser:startAgent', async (_e, rawPayload: unknown) => {
    const payload = AgentPromptSchema.parse(rawPayload);
    const provider = getPreferredProvider();
    const apiKey = getApiKey(provider);

    if (!apiKey) {
      return { ok: false, error: `No API key set for provider: ${provider}` };
    }

    try {
      await runAgentCommand(
        payload.commandId,
        payload.action,
        payload.instruction,
        apiKey,
        provider,
        (status) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('agent:status', status); },
        (log) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('agent:log', log); },
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('browser:cancelAgent', async () => {
    cancelAgentCommand();
    return { ok: true };
  });

  ipcMain.handle('browser:setTakeoverActive', async (_e, active: unknown) => {
    const isPaused = Boolean(active);
    setAgentPaused(isPaused);
    setWorkflowPaused(isPaused);
    return { ok: true };
  });

  ipcMain.handle('browser:submitCheckpoint', async (_e, checkpointId: string, response: any) => {
    try {
      await submitCheckpointResponse(checkpointId, response);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Workflow Execution ────────────────────────────────────────────────────

  ipcMain.handle('browser:startWorkflow', async (_e, rawPayload: unknown) => {
    let batch: AgentWorkflowBatchPayload;
    try {
      batch = AgentWorkflowBatchSchema.parse(rawPayload);
    } catch (err) {
      return { ok: false, error: `Invalid workflow payload: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (isWorkflowRunning()) {
      return { ok: false, error: 'A workflow is already running.' };
    }
    if (isAgentRunning()) {
      return { ok: false, error: 'An agent command is running. Cancel it first.' };
    }

    runWorkflow(
      batch,
      (status) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('workflow:runStatus', status); },
      (stepStatus) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('workflow:stepStatus', stepStatus); },
      (log) => { if (currentWindow && !currentWindow.isDestroyed()) currentWindow.webContents.send('agent:log', log); },
    ).catch((err) => {
      console.error('[workflow] Unexpected error:', err);
    });

    return { ok: true };
  });

  ipcMain.handle('browser:cancelWorkflow', async () => {
    cancelWorkflow();
    return { ok: true };
  });

  // ── Diagnostics / App ─────────────────────────────────────────────────────
  ipcMain.handle('app:getDiagnostics', async () => {
    return {
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
      appVersion: app.getVersion(),
    };
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
