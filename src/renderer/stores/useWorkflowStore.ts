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
  preferredModel?: string;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  hasGroqKey: boolean;
  hasDeepseekKey: boolean;
  hasNebiusKey: boolean;
  hasOpenRouterKey: boolean;
  headlessMode: boolean;
  isLoading: boolean;

  // Actions
  loadSettings: () => Promise<void>;
  setSignalingUrl: (url: string) => Promise<void>;
  setPreferredProvider: (provider: ApiProvider) => Promise<void>;
  setPreferredModel: (model: string) => Promise<void>;
  setApiKey: (provider: ApiProvider, value: string) => Promise<void>;
  setHeadlessMode: (headless: boolean) => Promise<void>;
  isSettingsOpen: boolean;
  setSettingsOpen: (isOpen: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  signalingUrl: 'http://localhost:3001',
  preferredProvider: 'openai',
  preferredModel: undefined,
  hasOpenAIKey: false,
  hasAnthropicKey: false,
  hasGeminiKey: false,
  hasGroqKey: false,
  hasDeepseekKey: false,
  hasNebiusKey: false,
  hasOpenRouterKey: false,
  headlessMode: true,
  isLoading: false,
  isSettingsOpen: false,

  loadSettings: async () => {
    set({ isLoading: true });
    try {
      const [signalingUrl, preferredProvider, preferredModel, hasOpenAIKey, hasAnthropicKey, hasGeminiKey, hasGroqKey, hasDeepseekKey, hasNebiusKey, hasOpenRouterKey, headlessMode] =
        await Promise.all([
          window.RemoteCtrlAPI.settings.getSignalingUrl(),
          window.RemoteCtrlAPI.settings.getPreferredProvider(),
          window.RemoteCtrlAPI.settings.getPreferredModel(),
          window.RemoteCtrlAPI.settings.hasApiKey('openai'),
          window.RemoteCtrlAPI.settings.hasApiKey('anthropic'),
          window.RemoteCtrlAPI.settings.hasApiKey('gemini'),
          window.RemoteCtrlAPI.settings.hasApiKey('groq'),
          window.RemoteCtrlAPI.settings.hasApiKey('deepseek'),
          window.RemoteCtrlAPI.settings.hasApiKey('nebius'),
          window.RemoteCtrlAPI.settings.hasApiKey('openrouter'),
          window.RemoteCtrlAPI.settings.getHeadlessMode(),
        ]);
      set({ signalingUrl, preferredProvider, preferredModel, hasOpenAIKey, hasAnthropicKey, hasGeminiKey, hasGroqKey, hasDeepseekKey, hasNebiusKey, hasOpenRouterKey, headlessMode, isLoading: false });
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

  setPreferredModel: async (model) => {
    await window.RemoteCtrlAPI.settings.setPreferredModel(model);
    set({ preferredModel: model });
  },

  setApiKey: async (provider, value) => {
    await window.RemoteCtrlAPI.settings.setApiKey(provider, value);
    set(() => {
      const updates: Partial<SettingsState> = {};
      if (provider === 'openai') updates.hasOpenAIKey = !!value;
      if (provider === 'anthropic') updates.hasAnthropicKey = !!value;
      if (provider === 'gemini') updates.hasGeminiKey = !!value;
      if (provider === 'groq') updates.hasGroqKey = !!value;
      if (provider === 'deepseek') updates.hasDeepseekKey = !!value;
      if (provider === 'nebius') updates.hasNebiusKey = !!value;
      if (provider === 'openrouter') updates.hasOpenRouterKey = !!value;
      return updates;
    });
  },

  setHeadlessMode: async (headless) => {
    await window.RemoteCtrlAPI.settings.setHeadlessMode(headless);
    set({ headlessMode: headless });
  },

  setSettingsOpen: (isOpen) => {
    set({ isSettingsOpen: isOpen });
  },
}));
