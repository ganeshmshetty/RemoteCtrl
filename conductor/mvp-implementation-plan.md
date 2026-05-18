# RemoteCtrl MVP Implementation Plan

## 1. MVP Objective

Build the first usable version of RemoteCtrl: an Electron desktop app where one user can host a visible Playwright browser, another user can connect by PIN, watch the browser over WebRTC, take manual control, and run AI-assisted browser actions on the Host machine.

The MVP should be strong enough to validate the product loop, not just prove connectivity. It should include local workflow creation/execution because workflows affect the core agent architecture. It should not include cloud workflow sharing or deep-link autonomous mode yet.

## 2. Product Scope

### 2.1 In Scope

- Unified Electron app with Host and Controller modes.
- Socket.io signaling server with 9-digit PIN rooms.
- WebRTC video stream from Host browser window to Controller.
- Reliable WebRTC data channel for commands, status, logs, and workflow messages.
- Unreliable WebRTC data channel for high-frequency mouse movement.
- Manual takeover mode using Playwright mouse and keyboard injection.
- Host-side Stagehand execution using the Host's local API key.
- One-shot ad-hoc agent prompts.
- Local saved workflow library.
- Remote workflow execution from Controller to Host.
- Basic workflow editor for ordered steps.
- Basic execution queue with pause/cancel boundaries.
- Capture metadata for reliable coordinate mapping.
- Minimal settings for API keys and connection configuration.
- Basic session logs in the Controller UI.

### 2.2 Explicitly Deferred

- Cloud Registry.
- Public shared workflow links.
- `RemoteCtrl://workflow/...` deep-link execution.
- Autonomous local link-click mode.
- rrweb deterministic replay.
- Advanced bot-detection/stealth stack.
- Hierarchical planner/executor multi-model orchestration.
- Browserbase verified browsers.
- Residential proxy management.
- Multi-controller sessions.
- Full audit/compliance dashboard.

## 3. Core User Flows

### 3.1 Host Flow

1. User opens RemoteCtrl and selects `Host`.
2. App checks required screen-capture permissions.
3. App launches a dedicated visible Playwright browser profile.
4. App registers a PIN with the signaling server.
5. Host sees the PIN and connection status.
6. Controller requests to join.
7. Host approves the connection.
8. App starts WebRTC negotiation and streams the browser window.
9. Host can stop sharing at any time.

### 3.2 Controller Flow

1. User opens RemoteCtrl and selects `Connect`.
2. User enters the Host PIN.
3. App joins the signaling room.
4. Host approves the connection.
5. Controller sees the remote browser stream.
6. Controller can send an AI prompt.
7. Controller can toggle takeover mode and manually control the browser.
8. Controller can run a saved local workflow on the Host.
9. Controller receives status and logs while commands execute.

### 3.3 Workflow Flow

1. Controller creates a local workflow with a name, optional start URL, and ordered steps.
2. Each step is one of `act`, `observe`, or `extract`.
3. Controller saves the workflow locally.
4. During a connected session, Controller selects a workflow and clicks `Run on Host`.
5. Host receives the workflow batch and queues it.
6. Host executes steps sequentially through Stagehand.
7. Host emits per-step status updates and logs.
8. Controller can cancel the current workflow.

## 4. Architecture Overview

### 4.1 Processes

- **Main process:** owns Playwright, Stagehand, browser lifecycle, API-key access, IPC validation, capture-source selection, and OS permission checks.
- **Renderer process:** owns React UI, WebRTC peer connection, video rendering, workflow editor, and user interactions.
- **Preload bridge:** exposes a narrow typed API from Renderer to Main.
- **Signaling server:** only matches Host and Controller by PIN and relays WebRTC offer/answer/ICE messages.

### 4.2 Execution Roles

- **Host:** runs the browser, runs Stagehand, owns API keys, streams video, receives commands.
- **Controller:** views video, sends prompts/workflows/input events, receives logs.

The Controller never executes Host-side browser actions locally. The Host is the execution environment for remote sessions.

## 5. MVP Feature Modules

### 5.1 Electron App Shell

Build a single app with mode-based routing:

- `Home`
- `HostSession`
- `ControllerSession`
- `Settings`
- `WorkflowLibrary`
- `WorkflowEditor`

Use a memory router or hash router. Avoid complex routing infrastructure.

### 5.2 Signaling

Use Socket.io for MVP.

Required server events:

```typescript
type HostRegisterPayload = {
  pin: string;
  capabilities?: {
    version: string;
    platform: NodeJS.Platform;
  };
};

type ControllerJoinPayload = {
  pin: string;
};

type SignalPayload = {
  sender: "host" | "controller";
  signal: unknown;
};
```

Rules:

- PIN expires after 10 minutes.
- One Controller per Host.
- Host must approve the Controller before WebRTC negotiation starts.
- Rooms are deleted when Host disconnects.
- Controller receives a clear error for expired, missing, or full rooms.

### 5.3 WebRTC Channels

Create one peer connection with video and two data channels.

#### Reliable Channel

Use for:

- Session setup.
- Capture metadata.
- Agent prompt.
- Workflow batch.
- Workflow status.
- Agent logs.
- Takeover request/release.
- Keyboard events.
- Mouse down/up/click/scroll.

#### Unreliable Input Channel

Use for:

- Mouse move only.

Configuration target:

```typescript
{
  ordered: false,
  maxRetransmits: 0
}
```

Rules:

- Drop mouse move events when buffered amount is high.
- Coalesce moves to latest position.
- Send at 30-60Hz depending on observed latency.
- Do not store mouse positions in React state.

### 5.4 Browser Capture

MVP target:

- Launch one dedicated Playwright Chromium window.
- Capture that window using Electron `desktopCapturer`.
- Stream via `getUserMedia` and WebRTC.

Capture metadata must be sent whenever the browser window or viewport changes:

```typescript
type CaptureMetadata = {
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
};
```

The Controller uses video intrinsic dimensions and displayed rect to compute stream-relative percentages. The Host maps stream-relative coordinates through `contentRect` into Playwright viewport coordinates.

Do not assume the streamed frame equals the Playwright viewport.

### 5.5 Manual Takeover

Takeover mode is a core MVP feature.

Controller behavior:

- Toggle `Takeover`.
- Overlay captures mouse and keyboard.
- Mouse move goes over unreliable channel.
- Click, scroll, and keyboard go over reliable channel.

Host behavior:

- Accept remote input only when session is active and takeover is active.
- Translate coordinates using capture metadata.
- Inject input through Playwright `page.mouse` and `page.keyboard`.

Cancellation model:

- Do not promise instant interruption of an active Stagehand call.
- If takeover is requested during agent execution, mark the current command as `cancelling`.
- Let the current atomic Stagehand action finish or hit timeout.
- Then enter `HUMAN_TAKEOVER`.

This avoids pretending Stagehand has a reliable pause/resume API.

### 5.6 Agent Prompt Execution

MVP agent command:

```typescript
type AgentPromptPayload = {
  commandId: string;
  action: "act" | "observe" | "extract";
  instruction: string;
};
```

Execution rules:

- Host executes one agent command at a time.
- Commands are queued or rejected while another command is running.
- `act` is the primary path.
- `observe` and `extract` are allowed because workflows need them, but the UI can initially emphasize `act`.
- Every command has a timeout.
- Every command emits `running`, `completed`, `failed`, or `cancelled`.

Initial Stagehand behavior:

- Use one active Playwright `Page`.
- Reuse the visible browser session.
- Stream concise logs to Controller.
- Keep the browser visible during execution.

### 5.7 Local Workflow Library

This is included in MVP because workflows shape the agent architecture.

Workflow model:

```typescript
type WorkflowStep = {
  id: string;
  action: "act" | "observe" | "extract";
  instruction: string;
  expected?: string;
};

type LocalWorkflow = {
  id: string;
  name: string;
  description?: string;
  startUrl?: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
};
```

Storage:

- Store workflows locally.
- Use a JSON file through Main process or a simple local database.
- Do not store workflows only in React state.
- Do not build cloud sync in MVP.

Workflow editor:

- Create workflow.
- Edit name and description.
- Add, remove, reorder steps.
- Choose step action.
- Save locally.
- Run selected workflow on connected Host.

### 5.8 Remote Workflow Execution

Workflow batch message:

```typescript
type AgentWorkflowBatchPayload = {
  workflowRunId: string;
  workflowId: string;
  name: string;
  startUrl?: string;
  steps: WorkflowStep[];
};
```

Execution rules:

- Host receives workflow batch.
- If `startUrl` exists, Host navigates to it before step 1.
- Host executes steps sequentially.
- Host emits status per workflow and per step.
- Controller can cancel the workflow.
- If a step fails, default behavior is stop the workflow.
- Later iterations can add `continueOnError`.

Workflow status:

```typescript
type WorkflowRunStatus = {
  workflowRunId: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  currentStepId?: string;
  currentStepIndex?: number;
  error?: string;
};
```

Step status:

```typescript
type WorkflowStepStatus = {
  workflowRunId: string;
  stepId: string;
  index: number;
  state: "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
};
```

### 5.9 Logs

MVP logs should be simple and useful:

- Connection status.
- Agent command status.
- Workflow step status.
- Stagehand log lines.
- Errors with short explanations.

Do not implement rrweb replay yet.

### 5.10 Settings

MVP settings:

- OpenAI API key.
- Anthropic API key if needed by selected Stagehand model.
- Signaling server URL.
- Preferred model/provider.
- Browser profile reset button.

API keys should be accessed by Main process. Renderer can ask whether a key is configured, but should not need to hold raw key values during normal operation.

## 6. State Machines

### 6.1 Host Session State

```text
IDLE
  -> CHECKING_PERMISSIONS
  -> LAUNCHING_BROWSER
  -> REGISTERING_PIN
  -> WAITING_FOR_CONTROLLER
  -> AWAITING_HOST_APPROVAL
  -> WEBRTC_CONNECTING
  -> SESSION_ACTIVE
  -> AGENT_EXECUTING
  -> CANCELLING_AGENT
  -> HUMAN_TAKEOVER
  -> SESSION_ACTIVE
  -> DISCONNECTED
```

### 6.2 Controller Session State

```text
IDLE
  -> PROMPTING_FOR_PIN
  -> SIGNALING_CONNECTING
  -> WAITING_FOR_HOST_APPROVAL
  -> WEBRTC_CONNECTING
  -> SESSION_ACTIVE
  -> CONTROLLING_REMOTELY
  -> SESSION_ACTIVE
  -> DISCONNECTED
```

### 6.3 Workflow Run State

```text
QUEUED
  -> RUNNING
  -> COMPLETED

RUNNING
  -> FAILED

RUNNING
  -> CANCELLING
  -> CANCELLED
```

## 7. IPC Surface

Expose narrow preload APIs.

```typescript
type RemoteCtrlAPI = {
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
    resetProfile: () => Promise<void>;
  };
  settings: {
    hasApiKey: (provider: string) => Promise<boolean>;
    setApiKey: (provider: string, value: string) => Promise<void>;
    getSignalingUrl: () => Promise<string>;
    setSignalingUrl: (url: string) => Promise<void>;
  };
  workflows: {
    list: () => Promise<LocalWorkflow[]>;
    save: (workflow: LocalWorkflow) => Promise<void>;
    delete: (workflowId: string) => Promise<void>;
  };
};
```

All IPC payloads must be validated in Main before use.

## 8. Data Channel Message Types

MVP message types:

```typescript
type MessageType =
  | "SESSION_START"
  | "CAPTURE_METADATA"
  | "AGENT_PROMPT"
  | "AGENT_STATUS_UPDATE"
  | "AGENT_LOG"
  | "AGENT_WORKFLOW_BATCH"
  | "WORKFLOW_RUN_STATUS"
  | "WORKFLOW_STEP_STATUS"
  | "WORKFLOW_CANCEL"
  | "TAKEOVER_REQUEST"
  | "TAKEOVER_RELEASE"
  | "REMOTE_INPUT_MOUSE"
  | "REMOTE_INPUT_KEYBOARD";
```

Envelope:

```typescript
type DataChannelMessage<T> = {
  type: MessageType;
  version: "1.0";
  timestamp: number;
  id?: string;
  payload: T;
};
```

Keep `version` from the start. It is cheap and avoids protocol churn later.

## 9. Implementation Phases

### Phase 0: Project Skeleton

- Create Electron + React + Vite app.
- Add TypeScript.
- Add basic app layout.
- Add Main/Preload/Renderer boundaries.
- Add local settings storage.
- Add basic workflow storage.

Exit criteria:

- App launches.
- Home screen renders.
- Settings can save provider configuration.
- Local workflow can be created and listed.

### Phase 1: Signaling And Session Setup

- Build Socket.io signaling server.
- Implement Host PIN registration.
- Implement Controller join.
- Implement Host approval modal.
- Implement session state transitions.

Exit criteria:

- Host gets PIN.
- Controller joins by PIN.
- Host approves or rejects.
- Both sides show correct connection state.

### Phase 2: Browser Launch And Streaming

- Launch dedicated Playwright browser.
- Capture browser window.
- Establish WebRTC video stream.
- Send capture metadata.
- Render video on Controller.
- Handle stop sharing and disconnect.

Exit criteria:

- Controller sees Host browser.
- Host can stop session.
- Controller handles stream end cleanly.

### Phase 3: Manual Takeover

- Add reliable and unreliable data channels.
- Implement mouse move coalescing.
- Implement click, scroll, and keyboard injection.
- Implement coordinate mapping through capture metadata.
- Add takeover toggle UI.

Exit criteria:

- Controller can move mouse, click, type, and scroll in Host browser.
- Input remains responsive under normal network conditions.
- Coordinates remain correct after window resize.

### Phase 4: Agent Prompt Execution

- Configure Host-side Stagehand.
- Add API-key presence checks.
- Implement `AGENT_PROMPT`.
- Emit agent status and logs.
- Add command timeout and failure handling.

Exit criteria:

- Controller sends one prompt.
- Host executes visibly in browser.
- Controller sees running/completed/failed status.

### Phase 5: Local Workflows And Remote Workflow Runs

- Build workflow list and editor.
- Persist workflows locally.
- Implement `AGENT_WORKFLOW_BATCH`.
- Implement Host-side workflow queue.
- Emit workflow and step statuses.
- Add workflow cancellation.

Exit criteria:

- Controller can create a workflow.
- Controller can run it on Host.
- Steps execute sequentially.
- Status updates appear per step.
- Failed step stops the workflow.

### Phase 6: MVP Hardening

- Add clear errors for permission failures.
- Add reconnect/disconnect cleanup.
- Add browser profile reset.
- Add basic telemetry-free diagnostics screen.
- Add packaging config for macOS, Windows, and Linux.

Exit criteria:

- App can be packaged locally.
- Main flows survive common failure cases.
- No known coordinate or session-state blockers remain.

## 10. Future Iteration Hooks

### 10.1 Cloud Registry

Do not implement in MVP, but keep workflow IDs and workflow payloads compatible with later upload.

Future cloud object:

```typescript
type SharedWorkflowRecord = {
  id: string;
  ownerId?: string;
  workflow: LocalWorkflow;
  createdAt: number;
  updatedAt: number;
};
```

### 10.2 Deep Links

Do not implement autonomous deep-link execution in MVP.

Future behavior:

- `RemoteCtrl://workflow/{id}` opens app.
- App fetches workflow from Cloud Registry.
- App shows mandatory review modal.
- User explicitly clicks execute.
- Workflow runs locally using local API key.

### 10.3 rrweb Audit Replay

Do not stream rrweb in MVP.

Future behavior:

- Record local session events.
- Batch and compress events.
- Store replay separately from real-time control channel.
- Never let audit traffic block control messages.

### 10.4 Advanced Agent Planning

Do not build a separate planner in MVP.

Future behavior:

- Planner converts a high-level goal into workflow steps.
- Executor runs each step through Stagehand.
- User can inspect and edit generated steps before execution.

### 10.5 Stealth And Bot Mitigation

Do not build stealth stack in MVP.

Future behavior:

- Use patched browser only if target sites require it.
- Add human-like cursor paths only after baseline control works.
- Add proxy support only after clear product need.

## 11. MVP Non-Goals

- No account system.
- No cloud sync.
- No billing.
- No multi-user collaboration.
- No browser extension.
- No web-only Controller.
- No unattended autonomous execution.
- No hidden browser execution.
- No complex prompt planner.
- No compliance-grade replay.

## 12. Acceptance Criteria

The MVP is complete when:

- A Host can launch a dedicated browser and receive a PIN.
- A Controller can connect by PIN after Host approval.
- The Controller can see the Host browser stream.
- The Controller can manually control the Host browser.
- The Controller can send a natural-language agent prompt.
- The Host executes the prompt with Stagehand.
- The Controller receives useful status and logs.
- The Controller can create and save a local workflow.
- The Controller can run that workflow on the Host.
- The Host executes workflow steps sequentially.
- The Controller can cancel an active workflow or take over after the current atomic action.
- The session can disconnect cleanly without orphaning browser or WebRTC resources.

## 13. Implementation Principle

Build the MVP as a real foundation, not a throwaway demo. Keep the protocol, state machines, workflow model, and process boundaries close to the long-term design. Defer cloud, sharing, replay, and stealth features until the core browser-control experience is reliable.
