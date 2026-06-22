// ─── Workflow Types ────────────────────────────────────────────────────────────

export type WorkflowStepAction = 'act' | 'observe' | 'extract';

export interface WorkflowStep {
  id: string;
  action: WorkflowStepAction;
  instruction: string;
  expected?: string;
}

export interface LocalWorkflow {
  id: string;
  name: string;
  description?: string;
  startUrl?: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

// Future-compatible cloud record shape (deferred, kept for type compatibility)
export interface SharedWorkflowRecord {
  id: string;
  ownerId?: string;
  workflow: LocalWorkflow;
  createdAt: number;
  updatedAt: number;
}

// ─── Settings Types ────────────────────────────────────────────────────────────

export type ApiProvider = 'openai' | 'anthropic' | 'gemini';
export type BrowserMode = 'internal' | 'local_chrome';

export interface AppSettings {
  signalingUrl: string;
  preferredProvider: ApiProvider;
  browserMode: BrowserMode;
  // API keys are NOT stored in renderer — Main process holds them
}

// ─── Session / Connection Types ────────────────────────────────────────────────

export type SessionRole = 'host' | 'controller';

export type HostSessionState =
  | 'IDLE'
  | 'CHECKING_PERMISSIONS'
  | 'LAUNCHING_BROWSER'
  | 'REGISTERING_PIN'
  | 'WAITING_FOR_CONTROLLER'
  | 'AWAITING_HOST_APPROVAL'
  | 'WEBRTC_CONNECTING'
  | 'SESSION_ACTIVE'
  | 'AGENT_EXECUTING'
  | 'CANCELLING_AGENT'
  | 'HUMAN_TAKEOVER'
  | 'DISCONNECTED';

export type ControllerSessionState =
  | 'IDLE'
  | 'PROMPTING_FOR_PIN'
  | 'SIGNALING_CONNECTING'
  | 'WAITING_FOR_HOST_APPROVAL'
  | 'WEBRTC_CONNECTING'
  | 'SESSION_ACTIVE'
  | 'CONTROLLING_REMOTELY'
  | 'DISCONNECTED';

// ─── Agent Types ───────────────────────────────────────────────────────────────

export interface AgentPromptPayload {
  commandId: string;
  action: WorkflowStepAction;
  instruction: string;
}

export interface AgentStatusPayload {
  commandId: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  result?: unknown;
  error?: string;
}

export interface AgentLogPayload {
  level: 'info' | 'warn' | 'error';
  message: string;
  step?: string;
}

export interface AgentCheckpointPayload {
  checkpointId: string;
  taskId: string;
  step: number;
  question: string;
  options: { id: string; label: string; description?: string; recommended?: boolean }[];
  context: {
    currentPage: string;
    taskProgress: string;
    uncertainty?: string;
  };
}

export interface CheckpointResponse {
  selectedOptionId: string;
  customInput?: string;
}

// ─── Workflow Run Types ────────────────────────────────────────────────────────

export interface AgentWorkflowBatchPayload {
  workflowRunId: string;
  workflowId: string;
  name: string;
  startUrl?: string;
  steps: WorkflowStep[];
}

export interface WorkflowRunStatus {
  workflowRunId: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepId?: string;
  currentStepIndex?: number;
  error?: string;
}

export interface WorkflowStepStatus {
  workflowRunId: string;
  stepId: string;
  index: number;
  state: 'running' | 'completed' | 'failed' | 'skipped';
  result?: unknown;
  error?: string;
}

// ─── Capture Metadata ─────────────────────────────────────────────────────────

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface CaptureMetadata {
  captureWidth: number;
  captureHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  contentRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ─── Data Channel Messages ────────────────────────────────────────────────────

export type MessageType =
  | 'SESSION_START'
  | 'CAPTURE_METADATA'
  | 'TAB_LIST'
  | 'SWITCH_TAB'
  | 'AGENT_PROMPT'
  | 'AGENT_STATUS_UPDATE'
  | 'AGENT_LOG'
  | 'AGENT_CHECKPOINT'
  | 'AGENT_CHECKPOINT_RESPONSE'
  | 'AGENT_WORKFLOW_BATCH'
  | 'WORKFLOW_RUN_STATUS'
  | 'WORKFLOW_STEP_STATUS'
  | 'WORKFLOW_CANCEL'
  | 'TAKEOVER_REQUEST'
  | 'TAKEOVER_RELEASE'
  | 'REMOTE_INPUT_MOUSE'
  | 'REMOTE_INPUT_KEYBOARD'
  | 'BROWSER_ACTION';

export interface DataChannelMessage<T = unknown> {
  type: MessageType;
  version: '1.0';
  timestamp: number;
  id?: string;
  payload: T;
}

// ─── Remote Input Types ────────────────────────────────────────────────────────

export interface RemoteMousePayload {
  action: 'move' | 'down' | 'up' | 'click' | 'scroll';
  xPercent: number;
  yPercent: number;
  button?: 'left' | 'right' | 'middle';
  deltaY?: number;
}

export interface RemoteKeyboardPayload {
  action: 'down' | 'up' | 'press';
  key: string;
}

// ─── IPC API Shape (matches preload contextBridge) ────────────────────────────

export interface DesktopSource {
  id: string;
  name: string;
}

export interface AppDiagnostics {
  browserRunning: boolean;
  agentRunning: boolean;
  workflowRunning: boolean;
  signalingConnected: boolean;
  signalingRole: string | null;
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasGeminiKey: boolean;
  preferredProvider: string;
  platform: string;
  electronVersion: string;
  nodeVersion: string;
  appVersion: string;
}

export interface RemoteCtrlAPI {
  app: {
    getDiagnostics: () => Promise<AppDiagnostics>;
    openSettings: () => Promise<void>;
  };
  host: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    approveController: (controllerId: string) => Promise<void>;
    rejectController: (controllerId: string) => Promise<void>;
  };
  controller: {
    connect: (pin: string) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  browser: {
    launch: (startUrl?: string) => Promise<string>;  // returns window title
    close: () => Promise<void>;
    getSources: () => Promise<DesktopSource[]>;
    resetProfile: () => Promise<void>;
    injectMouse: (payload: RemoteMousePayload) => Promise<void>;
    injectKeyboard: (payload: RemoteKeyboardPayload) => Promise<void>;
    startAgent: (payload: AgentPromptPayload) => Promise<{ ok: boolean; error?: string }>;
    cancelAgent: () => Promise<{ ok: boolean }>;
    startWorkflow: (payload: AgentWorkflowBatchPayload) => Promise<{ ok: boolean; error?: string }>;
    cancelWorkflow: () => Promise<{ ok: boolean }>;
    getTabs: () => Promise<TabInfo[]>;
    switchTab: (tabId: string) => Promise<void>;
    goBack: () => Promise<void>;
    goForward: () => Promise<void>;
    reload: () => Promise<void>;
    navigate: (url: string) => Promise<void>;
    closeTab: (tabId: string) => Promise<void>;
    newTab: () => Promise<void>;
    submitCheckpoint: (checkpointId: string, response: CheckpointResponse) => Promise<void>;
  };
  webrtc: {
    sendSignal: (signal: unknown) => Promise<void>;
  };
  settings: {
    hasApiKey: (provider: ApiProvider) => Promise<boolean>;
    setApiKey: (provider: ApiProvider, value: string) => Promise<void>;
    getSignalingUrl: () => Promise<string>;
    setSignalingUrl: (url: string) => Promise<void>;
    getPreferredProvider: () => Promise<ApiProvider>;
    setPreferredProvider: (provider: ApiProvider) => Promise<void>;
    getBrowserMode: () => Promise<BrowserMode>;
    setBrowserMode: (mode: BrowserMode) => Promise<void>;
    getHeadlessMode: () => Promise<boolean>;
    setHeadlessMode: (headless: boolean) => Promise<void>;
  };
  workflows: {
    list: () => Promise<LocalWorkflow[]>;
    save: (workflow: LocalWorkflow) => Promise<void>;
    delete: (workflowId: string) => Promise<void>;
  };
  // Event listeners (Main -> Renderer push events)
  on: {
    hostStateChange: (cb: (state: HostSessionState) => void) => () => void;
    controllerStateChange: (cb: (state: ControllerSessionState) => void) => () => void;
    controllerJoinRequest: (cb: (controllerId: string) => void) => () => void;
    agentStatus: (cb: (payload: AgentStatusPayload) => void) => () => void;
    agentLog: (cb: (payload: AgentLogPayload) => void) => () => void;
    pin: (cb: (pin: string) => void) => () => void;
    error: (cb: (message: string) => void) => () => void;
    webrtcSignal: (cb: (signal: unknown) => void) => () => void;
    captureMetadata: (cb: (meta: CaptureMetadata) => void) => () => void;
    windowTitle: (cb: (title: string) => void) => () => void;
    workflowRunStatus: (cb: (status: WorkflowRunStatus) => void) => () => void;
    workflowStepStatus: (cb: (status: WorkflowStepStatus) => void) => () => void;
    tabsChange: (cb: (tabs: TabInfo[]) => void) => () => void;
    screencastFrame: (cb: (frameData: Uint8Array) => void) => () => void;
    agentCheckpoint: (cb: (payload: AgentCheckpointPayload) => void) => () => void;
  };
}

// Extend Window to include RemoteCtrlAPI
declare global {
  interface Window {
    RemoteCtrlAPI: RemoteCtrlAPI;
  }
}
