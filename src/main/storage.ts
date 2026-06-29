import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { LocalWorkflow, ApiProvider, BrowserMode } from '../shared/types.js';
import { PersistedSettingsSchema, PersistedSettings, LocalWorkflowSchema } from '../shared/schemas.js';

import { fileURLToPath } from 'url';
import { DEFAULT_MODELS } from '../shared/default-models.js';

// ─── Paths ─────────────────────────────────────────────────────────────────────

const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const WORKFLOWS_FILE = path.join(USER_DATA, 'workflows.json');
const API_KEYS_FILE = path.join(USER_DATA, 'api-keys.json');
const MODELS_FILE = path.join(USER_DATA, 'models.json');

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Settings Storage ─────────────────────────────────────────────────────────

let _settingsCache: PersistedSettings | null = null;

export function loadSettings(): PersistedSettings {
  if (_settingsCache) return _settingsCache;
  const raw = readJson(SETTINGS_FILE, {});
  const result = PersistedSettingsSchema.safeParse(raw);
  if (result.success) {
    _settingsCache = result.data;
  } else {
    _settingsCache = PersistedSettingsSchema.parse({});
  }
  return _settingsCache;
}

export function saveSettings(settings: PersistedSettings) {
  _settingsCache = settings;
  writeJson(SETTINGS_FILE, settings);
}

export function getSignalingUrl(): string {
  return loadSettings().signalingUrl;
}

export function setSignalingUrl(url: string) {
  const s = loadSettings();
  saveSettings({ ...s, signalingUrl: url });
}

export function getPreferredProvider(): ApiProvider {
  return loadSettings().preferredProvider;
}

export function setPreferredProvider(provider: ApiProvider) {
  const s = loadSettings();
  saveSettings({ ...s, preferredProvider: provider });
}

export function getPreferredModel(): string | undefined {
  return loadSettings().preferredModel;
}

export function setPreferredModel(model: string) {
  const s = loadSettings();
  saveSettings({ ...s, preferredModel: model });
}

export function getBrowserMode(): BrowserMode {
  return loadSettings().browserMode;
}

export function setBrowserMode(mode: BrowserMode) {
  const s = loadSettings();
  saveSettings({ ...s, browserMode: mode });
}

export function getHeadlessMode(): boolean {
  return loadSettings().headlessMode;
}

export function setHeadlessMode(headless: boolean) {
  const s = loadSettings();
  saveSettings({ ...s, headlessMode: headless });
}

// ─── Models Storage ─────────────────────────────────────────────────────────

let _modelsCache: Record<string, string[]> | null = null;

export function getModelsList(provider: ApiProvider): string[] {
  // 1. Try local cache
  if (!_modelsCache) {
    _modelsCache = readJson<Record<string, string[]>>(MODELS_FILE, {});
  }
  const localCache = _modelsCache;
  if (localCache[provider] && localCache[provider].length > 0) {
    return localCache[provider];
  }

  // 2. Fallback to bundled defaults
  return DEFAULT_MODELS[provider] || [];
}

export function saveModelsList(provider: ApiProvider, models: string[]) {
  // 1. Update local cache
  if (!_modelsCache) {
    _modelsCache = readJson<Record<string, string[]>>(MODELS_FILE, {});
  }
  _modelsCache[provider] = models;
  writeJson(MODELS_FILE, _modelsCache);

  // 2. Dev mode: Write back to src/shared/default-models.ts
  if (!app.isPackaged) {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      // __dirname is dist/main, so src is ../../src
      const tsPath = path.join(__dirname, '../../src/shared/default-models.ts');
      
      if (fs.existsSync(tsPath)) {
        const content = fs.readFileSync(tsPath, 'utf-8');
        const jsonMatch = content.match(/export const DEFAULT_MODELS: Record<ApiProvider, string\[\]> = (\{[\s\S]*?\});/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          parsed[provider] = models;
          const newJson = JSON.stringify(parsed, null, 2);
          const newContent = content.replace(jsonMatch[1], newJson);
          fs.writeFileSync(tsPath, newContent, 'utf-8');
        }
      }
    } catch (e) {
      console.error('Failed to auto-update default-models.ts', e);
    }
  }
}

// ─── API Key Storage (separate file, not settings.json) ───────────────────────
// Keys are stored in plain JSON for MVP. In production, use keytar (OS keychain).

interface ApiKeyStore {
  [provider: string]: string;
}

let _apiKeysCache: ApiKeyStore | null = null;

function loadApiKeys(): ApiKeyStore {
  if (!_apiKeysCache) {
    _apiKeysCache = readJson<ApiKeyStore>(API_KEYS_FILE, {});
  }
  return _apiKeysCache;
}

export function hasApiKey(provider: ApiProvider): boolean {
  const store = loadApiKeys();
  return Boolean(store[provider] && store[provider].length > 0);
}

export function setApiKey(provider: ApiProvider, value: string) {
  const store = loadApiKeys();
  store[provider] = value;
  writeJson(API_KEYS_FILE, store);
}

export function getApiKey(provider: ApiProvider): string | null {
  const store = loadApiKeys();
  return store[provider] ?? null;
}

// ─── Workflow Storage ─────────────────────────────────────────────────────────

interface WorkflowStore {
  workflows: LocalWorkflow[];
}

let _workflowsCache: WorkflowStore | null = null;

function loadWorkflowStore(): WorkflowStore {
  if (!_workflowsCache) {
    _workflowsCache = readJson<WorkflowStore>(WORKFLOWS_FILE, { workflows: [] });
  }
  return _workflowsCache;
}

export function listWorkflows(): LocalWorkflow[] {
  return loadWorkflowStore().workflows;
}

export function saveWorkflow(workflow: LocalWorkflow): void {
  // Validate before persisting
  const parsed = LocalWorkflowSchema.parse(workflow);
  const store = loadWorkflowStore();
  const idx = store.workflows.findIndex((w) => w.id === parsed.id);
  if (idx >= 0) {
    store.workflows[idx] = parsed;
  } else {
    store.workflows.push(parsed);
  }
  writeJson(WORKFLOWS_FILE, store);
}

export function deleteWorkflow(workflowId: string): void {
  const store = loadWorkflowStore();
  store.workflows = store.workflows.filter((w) => w.id !== workflowId);
  writeJson(WORKFLOWS_FILE, store);
}
