import { create } from 'zustand';

export type RightPanelTab = 'agent' | 'workflows';

interface UIState {
  rightPanelTab: RightPanelTab;
  isWorkflowEditorOpen: boolean;
  editingWorkflowId: string | null;
  isSettingsOpen: boolean;
  setRightPanelTab: (tab: RightPanelTab) => void;
  openWorkflowEditor: (workflowId?: string) => void;
  closeWorkflowEditor: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  rightPanelTab: 'agent',
  isWorkflowEditorOpen: false,
  editingWorkflowId: null,
  isSettingsOpen: false,

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  
  openWorkflowEditor: (workflowId) => set({ 
    isWorkflowEditorOpen: true, 
    editingWorkflowId: workflowId ?? null 
  }),
  
  closeWorkflowEditor: () => set({ 
    isWorkflowEditorOpen: false, 
    editingWorkflowId: null 
  }),

  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
}));
