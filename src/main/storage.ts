import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { LocalWorkflow, ApiProvider, BrowserMode } from '../shared/types.js';
import { PersistedSettingsSchema, PersistedSettings, LocalWorkflowSchema } from '../shared/schemas.js';

// ─── Paths ─────────────────────────────────────────────────────────────────────

const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const WORKFLOWS_FILE = path.join(USER_DATA, 'workflows.json');
const API_KEYS_FILE = path.join(USER_DATA, 'api-keys.json');

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

export function loadSettings(): PersistedSettings {
  const raw = readJson(SETTINGS_FILE, {});
  const result = PersistedSettingsSchema.safeParse(raw);
  if (result.success) return result.data;
  // Return defaults if parse fails
  return PersistedSettingsSchema.parse({});
}

export function saveSettings(settings: PersistedSettings) {
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

// ─── API Key Storage (separate file, not settings.json) ───────────────────────
// Keys are stored in plain JSON for MVP. In production, use keytar (OS keychain).

interface ApiKeyStore {
  [provider: string]: string;
}

export function hasApiKey(provider: ApiProvider): boolean {
  const store = readJson<ApiKeyStore>(API_KEYS_FILE, {});
  return Boolean(store[provider] && store[provider].length > 0);
}

export function setApiKey(provider: ApiProvider, value: string) {
  const store = readJson<ApiKeyStore>(API_KEYS_FILE, {});
  store[provider] = value;
  writeJson(API_KEYS_FILE, store);
}

export function getApiKey(provider: ApiProvider): string | null {
  const store = readJson<ApiKeyStore>(API_KEYS_FILE, {});
  return store[provider] ?? null;
}

// ─── Workflow Storage ─────────────────────────────────────────────────────────

interface WorkflowStore {
  workflows: LocalWorkflow[];
}

function loadWorkflowStore(): WorkflowStore {
  return readJson<WorkflowStore>(WORKFLOWS_FILE, { workflows: [] });
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
