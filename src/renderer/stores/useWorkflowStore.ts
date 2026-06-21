import { create } from 'zustand';
import type { LocalWorkflow, ApiProvider } from '../../shared/types';

interface WorkflowState {
  workflows: LocalWorkflow[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setWorkflows: (workflows: LocalWorkflow[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Async thunks (call window.RemoteCtrlAPI under the hood)
  loadWorkflows: () => Promise<void>;
  saveWorkflow: (workflow: LocalWorkflow) => Promise<void>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: [],
  isLoading: false,
  error: null,

  setWorkflows: (workflows) => set({ workflows }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  loadWorkflows: async () => {
    set({ isLoading: true, error: null });
    try {
      const workflows = await window.RemoteCtrlAPI.workflows.list();
      set({ workflows, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  saveWorkflow: async (workflow) => {
    try {
      await window.RemoteCtrlAPI.workflows.save(workflow);
      await get().loadWorkflows();
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  deleteWorkflow: async (workflowId) => {
    try {
      await window.RemoteCtrlAPI.workflows.delete(workflowId);
      set((state) => ({
        workflows: state.workflows.filter((w) => w.id !== workflowId),
      }));
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },
}));

// ─── Settings Store ───────────────────────────────────────────────────────────

interface SettingsState {
  signalingUrl: string;
  preferredProvider: ApiProvider;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  headlessMode: boolean;
  isLoading: boolean;
  isSettingsOpen: boolean;

  // Actions
  loadSettings: () => Promise<void>;
  setSignalingUrl: (url: string) => Promise<void>;
  setPreferredProvider: (provider: ApiProvider) => Promise<void>;
  setApiKey: (provider: ApiProvider, value: string) => Promise<void>;
  setHeadlessMode: (headless: boolean) => Promise<void>;
  setSettingsOpen: (isOpen: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  signalingUrl: 'http://localhost:3001',
  preferredProvider: 'openai',
  hasOpenAIKey: false,
  hasAnthropicKey: false,
  hasGeminiKey: false,
  headlessMode: true,
  isLoading: false,
  isSettingsOpen: false,

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const [signalingUrl, preferredProvider, hasOpenAIKey, hasAnthropicKey, hasGeminiKey, headlessMode] =
        await Promise.all([
          window.RemoteCtrlAPI.settings.getSignalingUrl(),
          window.RemoteCtrlAPI.settings.getPreferredProvider(),
          window.RemoteCtrlAPI.settings.hasApiKey('openai'),
          window.RemoteCtrlAPI.settings.hasApiKey('anthropic'),
          window.RemoteCtrlAPI.settings.hasApiKey('gemini'),
          window.RemoteCtrlAPI.settings.getHeadlessMode(),
        ]);
      set({ signalingUrl, preferredProvider, hasOpenAIKey, hasAnthropicKey, hasGeminiKey, headlessMode, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  setSignalingUrl: async (url) => {
    await window.RemoteCtrlAPI.settings.setSignalingUrl(url);
    set({ signalingUrl: url });
  },

  setPreferredProvider: async (provider) => {
    await window.RemoteCtrlAPI.settings.setPreferredProvider(provider);
    set({ preferredProvider: provider });
  },

  setApiKey: async (provider, value) => {
    await window.RemoteCtrlAPI.settings.setApiKey(provider, value);
    set(provider === 'openai' ? { hasOpenAIKey: true } : provider === 'anthropic' ? { hasAnthropicKey: true } : { hasGeminiKey: true });
  },

  setHeadlessMode: async (headless) => {
    await window.RemoteCtrlAPI.settings.setHeadlessMode(headless);
    set({ headlessMode: headless });
  },

  setSettingsOpen: (isOpen) => {
    set({ isSettingsOpen: isOpen });
  },
}));
