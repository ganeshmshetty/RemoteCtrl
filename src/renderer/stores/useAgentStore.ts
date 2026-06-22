import { create } from 'zustand';
import type {
  AgentStatusPayload,
  AgentLogPayload,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentCheckpointPayload,
} from '../../shared/types';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'log' | 'error' | 'workflow' | 'checkpoint';
  text: string;
  timestamp: number;
  checkpointPayload?: AgentCheckpointPayload;
}

type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
type WorkflowState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

interface AgentState {
  isTakeoverActive: boolean;
  agentStatus: AgentStatus;
  activeCommandId: string | null;
  chatHistory: ChatMessage[];
  executionLogs: AgentLogPayload[];
  currentAction: string | null;

  // Workflow run state
  workflowRunState: WorkflowState;
  workflowRunId: string | null;
  workflowStepStatuses: WorkflowStepStatus[];
  currentStepIndex: number | null;

  // Actions
  setTakeoverActive: (active: boolean) => void;
  setAgentStatus: (status: AgentStatus) => void;
  setActiveCommandId: (id: string | null) => void;
  appendMessage: (msg: ChatMessage) => void;
  handleAgentStatus: (payload: AgentStatusPayload) => void;
  handleAgentLog: (payload: AgentLogPayload) => void;
  handleWorkflowRunStatus: (status: WorkflowRunStatus) => void;
  handleWorkflowStepStatus: (status: WorkflowStepStatus) => void;
  handleAgentCheckpoint: (payload: AgentCheckpointPayload) => void;
  clearHistory: () => void;
  clearWorkflow: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  isTakeoverActive: false,
  agentStatus: 'idle',
  activeCommandId: null,
  chatHistory: [],
  executionLogs: [],
  currentAction: null,

  workflowRunState: 'idle',
  workflowRunId: null,
  workflowStepStatuses: [],
  currentStepIndex: null,

  setTakeoverActive: (active) => set({ isTakeoverActive: active }),
  setAgentStatus: (agentStatus) => set({ agentStatus }),
  setActiveCommandId: (id) => set({ activeCommandId: id }),

  appendMessage: (msg) =>
    set((state) => ({
      chatHistory: [...state.chatHistory, msg],
    })),

  handleAgentStatus: (payload) => {
    const statusMap: Record<string, AgentStatus> = {
      running: 'running',
      completed: 'completed',
      failed: 'error',
      cancelled: 'idle',
      paused: 'paused',
    };
    
    const updates: Partial<AgentState> = {
      agentStatus: statusMap[payload.state] ?? 'idle',
      activeCommandId: payload.state === 'running' ? payload.commandId : null,
    };

    if (payload.state === 'running') {
      updates.currentAction = 'Initializing agent...';
    } else if (['completed', 'failed', 'cancelled'].includes(payload.state)) {
      updates.currentAction = null;
    }

    set(updates);
    
    if (payload.state === 'completed') {
      const formattedResult = formatAgentResult(payload.result);
      get().appendMessage({
        id: `status-${payload.commandId}-${Date.now()}`,
        sender: 'agent',
        type: 'status',
        text: formattedResult,
        timestamp: Date.now(),
      });
    } else if (payload.state === 'failed') {
      get().appendMessage({
        id: `error-${payload.commandId}-${Date.now()}`,
        sender: 'agent',
        type: 'error',
        text: `I encountered an issue and couldn't complete the task: ${payload.error || 'Unknown error'}`,
        timestamp: Date.now(),
      });
    }
  },

  handleAgentLog: (payload) => {
    set((state) => {
      // Only set current action if it's an info-level log without being overly verbose.
      // Stagehand logs can be chatty, so we'll just pick the most recent one.
      const isActionable = payload.level === 'info' && !payload.message.includes('browser-use') && !payload.message.includes('playwright');
      return {
        executionLogs: [...(state.executionLogs || []), payload],
        currentAction: isActionable ? payload.message : state.currentAction,
      };
    });
  },

  handleWorkflowRunStatus: (status) => {
    const stateMap: Record<WorkflowRunStatus['state'], WorkflowState> = {
      queued: 'idle',
      running: 'running',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
    };
    set({
      workflowRunState: stateMap[status.state] ?? 'idle',
      workflowRunId: status.workflowRunId,
      currentStepIndex: status.currentStepIndex ?? null,
    });
  },

  handleWorkflowStepStatus: (status) => {
    set((state) => {
      const existing = state.workflowStepStatuses.findIndex(
        (s) => s.stepId === status.stepId && s.workflowRunId === status.workflowRunId,
      );
      const updated = [...state.workflowStepStatuses];
      if (existing >= 0) {
        updated[existing] = status;
      } else {
        updated.push(status);
      }
      return { workflowStepStatuses: updated };
    });
  },

  handleAgentCheckpoint: (payload) => {
    get().appendMessage({
      id: `checkpoint-${payload.checkpointId}`,
      sender: 'agent',
      type: 'checkpoint',
      text: payload.question,
      timestamp: Date.now(),
      checkpointPayload: payload,
    });
  },

  clearHistory: () => set({ chatHistory: [], executionLogs: [], currentAction: null }),

  clearWorkflow: () =>
    set({
      workflowRunState: 'idle',
      workflowRunId: null,
      workflowStepStatuses: [],
      currentStepIndex: null,
    }),
}));

function formatAgentResult(result: any): string {
  if (!result) return 'I successfully completed the task!';
  
  if (typeof result === 'string') return result;
  
  if (typeof result === 'object') {
    if (result.success !== undefined && result.message) {
      return result.message;
    }
    
    if (Array.isArray(result)) {
      if (result.length === 0) return 'I found no results.';
      const items = result.map(item => {
        if (typeof item === 'object') {
          return Object.entries(item)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
        }
        return String(item);
      });
      return 'Here is what I found:\n\n' + items.map(i => `• ${i}`).join('\n');
    }

    return 'Here is what I found:\n\n' + Object.entries(result)
      .map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join('\n');
  }
  
  return String(result);
}
