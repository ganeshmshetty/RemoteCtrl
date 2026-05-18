# RemoteCtrl Technical Specification

This document details the system contracts, protocols, and state machines required to implement the RemoteCtrl ("AnyDesk for Browsers") architecture.

## 1. Signaling Server API (Socket.io)

The signaling server's sole responsibility is WebRTC offer/answer exchange and matching the 9-digit PIN. We will use `socket.io` for its robust connection handling and room semantics.

### 1.1 Namespaces & Rooms
- Connections are made to the default namespace `/`.
- Rooms are implicitly defined by the 9-digit PIN (e.g., room `'482910482'`).
- **Security:** PINs should have a TTL (e.g., 10 mins). Server must rate-limit room joining.

### 1.2 Host Events
- **Emit: `host:register`**
  - **Payload:** `{ pin: string, capabilities?: object }`
  - **Action:** The Host joins the socket room identified by `pin`.
- **Receive: `controller:joined`**
  - **Action:** Triggered when a Controller enters the room. Host MUST display a "Allow remote connection from [ID]?" modal to the user. WebRTC negotiation starts only after user approval.

### 1.3 Controller Events
- **Emit: `controller:join`**
  - **Payload:** `{ pin: string }`
  - **Action:** Controller attempts to join the room.
  - **Response (Ack):** `{ success: boolean, error?: string }` (Fails if room doesn't exist or is full).

### 1.4 WebRTC Negotiation Events (Relayed)
These events are emitted by either peer and relayed by the server to the *other* peer in the room.
- **Emit/Receive: `webrtc:signal`**
  - **Payload:** `{ sender: 'host' | 'controller', signal: RTCSessionDescriptionInit | RTCIceCandidateInit }`
  - **Action:** Transparently pass the `simple-peer` signal data to the other party to establish the P2P connection.

---

## 2. WebRTC Data Channel Protocol

Once the WebRTC P2P connection is established via `simple-peer`, communication is split across two channels:
1. **Reliable Channel:** For control messages, logs, and setup (ordered).
2. **Unreliable Channel:** For high-frequency mouse movements (unordered, no retransmits).

### 2.1 Message Envelope
Every message sent over the Data Channel MUST follow this envelope structure:
```typescript
interface DataChannelMessage<T = any> {
  type: MessageType;
  timestamp: number;
  version: string; // e.g. "1.0.0"
  payload: T;
}

enum MessageType {
  // Setup
  SESSION_START = 'SESSION_START',
  CAPTURE_METADATA = 'CAPTURE_METADATA', // Sent by Host to Controller
  
  // Agent Control
  AGENT_PROMPT = 'AGENT_PROMPT',
  AGENT_WORKFLOW_BATCH = 'AGENT_WORKFLOW_BATCH',
  AGENT_STATUS_UPDATE = 'AGENT_STATUS_UPDATE',
  AGENT_LOG = 'AGENT_LOG',
  
  // Audit / rrweb
  RRWEB_EVENT = 'RRWEB_EVENT',
  
  // Takeover / Human Input
  TAKEOVER_REQUEST = 'TAKEOVER_REQUEST',
  TAKEOVER_RELEASE = 'TAKEOVER_RELEASE',
  REMOTE_INPUT_MOUSE = 'REMOTE_INPUT_MOUSE',
  REMOTE_INPUT_KEYBOARD = 'REMOTE_INPUT_KEYBOARD'
}
```

### 2.2 Payload Definitions

#### Controller -> Host: Session Start
Securely initiates a session and overrides Host config if allowed.
```typescript
// type: SESSION_START
interface SessionStartPayload {
  config: {
    headless: boolean; // Overrides host default if allowed
  }
}

#### Host -> Controller: Capture Metadata
Sent by the Host whenever the browser window size or device scale changes.
```typescript
// type: CAPTURE_METADATA
interface CaptureMetadataPayload {
  viewportWidth: number;  // Playwright CSS pixels
  viewportHeight: number;
  deviceScaleFactor: number;
  contentRect: { x: number, y: number, width: number, height: number }; // Relative to capture source
}
```
```

#### Controller -> Host: Agent Prompt
Initiates a Stagehand `page.act()` or `page.extract()` command.
```typescript
// type: AGENT_PROMPT
interface AgentPromptPayload {
  commandId: string; // UUID for tracking
  action: 'act' | 'extract' | 'observe';
  instruction: string;
}
```

#### Host -> Controller: Agent Status & Logs
Streams execution updates from Stagehand back to the Controller's UI.
```typescript
// type: AGENT_STATUS_UPDATE
interface AgentStatusPayload {
  commandId: string;
  state: 'running' | 'completed' | 'failed' | 'paused';
  result?: any; // The return value of the act/extract call
  error?: string;
}

// type: AGENT_LOG
interface AgentLogPayload {
  level: 'info' | 'warn' | 'error';
  message: string;
  step?: string; // Optional stagehand internal step
}
```

#### Host -> Controller: Audit Stream
Streams `rrweb` events for deterministic replay.
```typescript
// type: RRWEB_EVENT
interface RrwebEventPayload {
  event: any; // Raw rrweb event object
}
```

#### Controller -> Host: Human Input (Takeover Mode)
Sent extremely frequently. To prevent WebRTC data channel congestion (SCTP buffer bloat), mouse movements must be optimized.

1. **Throttling:** The Controller must throttle mouse capture using `requestAnimationFrame` (~60Hz).
2. **Backpressure:** The Controller must check `peer.bufferedAmount < 65536` before sending.
3. **Payload Format:** While clicks/keys can be JSON, high-frequency `move` events should ideally be serialized into a binary `Uint16Array` for performance, or at minimum, a heavily minified JSON array `[xPercent, yPercent]` rather than a verbose object.

```typescript
// type: REMOTE_INPUT_MOUSE (JSON representation for clicks/scrolls)
interface RemoteMousePayload {
  action: 'move' | 'down' | 'up' | 'click' | 'scroll';
  // Coordinates must be RELATIVE percentages (0.0 to 1.0)
  xPercent: number; 
  yPercent: number;
  button?: 'left' | 'right' | 'middle';
  deltaY?: number; // For scrolling
}

// type: REMOTE_INPUT_KEYBOARD
interface RemoteKeyboardPayload {
  action: 'down' | 'up' | 'press';
  key: string; // Standard KeyboardEvent.key values (e.g., 'Enter', 'a', 'Shift')
}
```

---

## 3. Application State Machines

### 3.1 Host Application State
```text
[ IDLE ]
   |
   | (User clicks "Host")
   v
[ GENERATING_PIN ] -> Connects to Signaling Server
   |
   v
[ WAITING_FOR_CONTROLLER ] -> Pin displayed on screen
   |
   | (Controller connects, WebRTC negotiation)
   v
[ WEBRTC_CONNECTING ]
   |
   v
[ SESSION_ACTIVE ] <----------------------------------+
   |                                                  |
   | (Receives AGENT_PROMPT)                          |
   v                                                  |
[ AGENT_EXECUTING ] -> Runs Stagehand/Playwright      |
   |                                                  |
   | (Receives TAKEOVER_REQUEST)                      |
   v                                                  |
[ HUMAN_TAKEOVER ] -> Pauses Stagehand, injects input |
   |                                                  |
   | (Receives TAKEOVER_RELEASE)                      |
   +--------------------------------------------------+
```

### 3.2 Controller Application State
```text
[ IDLE ]
   |
   | (User clicks "Connect")
   v
[ PROMPTING_FOR_PIN ]
   |
   | (User enters PIN)
   v
[ SIGNALING_CONNECTING ]
   |
   v
[ WEBRTC_CONNECTING ]
   |
   v
[ SESSION_ACTIVE ] (Viewing Stream)
   |
   | (User submits prompt) -> State remains Active, UI shows "Running"
   |
   | (User clicks "Takeover")
   v
[ CONTROLLING_REMOTELY ] -> Captures local mouse/kb, sends Input Payloads
   |
   | (User clicks "Release")
   v
[ SESSION_ACTIVE ]
```

---

## 4. Electron Process Boundaries (IPC Contracts)

To maintain security and performance, we must strictly separate the Renderer (UI) and the Main (Node.js/Playwright) processes.

### 4.1 Host Mode Boundaries
- **Renderer Process:** 
  - Handles UI (showing PIN, connection status).
  - Handles `simple-peer` WebRTC connection.
  - Receives `MediaStream` from Main process via `navigator.mediaDevices.getUserMedia` (using `desktopCapturer` source ID).
- **Main Process:** 
  - Runs Playwright and Stagehand.
  - Exposes IPC handlers for the Renderer.
  - **Security:** ALL IPC calls from Renderer MUST be validated against schemas. Main must enforce rate-limits and session-state checks (e.g., `injectMouse` is only valid when `isTakeoverActive` is true).
- **Renderer -> Main IPC (`contextBridge`):**
  - `startAgent(prompt)`: Forwarded from WebRTC Data Channel.
  - `injectMouse(payload)`: Forwarded from WebRTC Data Channel during takeover.
  - `injectKeyboard(payload)`: Forwarded from WebRTC Data Channel during takeover.
- **Main -> Renderer IPC:**
  - `agentStatus(status)`: Forwards to WebRTC Data Channel.
  - `agentLog(log)`: Forwards to WebRTC Data Channel.

### 4.2 Coordinate Translation Math (Crucial)
When `REMOTE_INPUT_MOUSE` is received by the Host, the percentages are translated using the **Authoritative Capture Metadata** sent earlier:
```javascript
// Inside Host Main Process
function handleRemoteMouse(payload, page, metadata) {
  // Use metadata sent by Host to ensure 1:1 precision
  const absoluteX = payload.xPercent * metadata.viewportWidth;
  const absoluteY = payload.yPercent * metadata.viewportHeight;
  
  if (payload.action === 'click') {
    page.mouse.click(absoluteX, absoluteY);
  } else if (payload.action === 'move') {
    page.mouse.move(absoluteX, absoluteY);
  }
}
```

## 5. Security & Isolation

- **API Keys:** **The Host machine must ALWAYS provide the API key.** The Controller cannot send their key over the network. If the Host does not have an API key configured, agent commands will fail. For the MVP, keys can be stored in a local `.env` or app settings.
- **Playwright Profile:** We will launch Playwright using `launchPersistentContext` pointing to a dedicated folder (e.g., `~/.RemoteCtrl/browser-profile`). This prevents the AI from accidentally accessing the user's personal default Chrome profile.

---

## 6. Agent Execution Loop (Stagehand Integration)

When the Host's Renderer process receives an `AGENT_PROMPT` payload over the WebRTC Data Channel, it forwards it to the Main process via IPC. The Main process then orchestrates the execution using Stagehand.

### 6.1 Execution Flow

1. **Receive & Acknowledge:**
   - Main process receives the `startAgent(prompt)` IPC call.
   - Emits `AGENT_STATUS_UPDATE` (state: `running`) back to the Renderer (which forwards it over WebRTC to the Controller).

2. **Stagehand Initialization (if needed):**
   - If this is the first command of the session, the Main process initializes `Stagehand` with the active Playwright `page` and the provided LLM API keys.
   - We inject a custom logger into Stagehand to intercept its internal logs:
     ```javascript
     const stagehand = new Stagehand({
       page: activePage,
       env: 'LOCAL',
       logger: (logLine) => {
         // Forward logs to Controller
         sendToRenderer('agentLog', { level: 'info', message: logLine.message });
       }
     });
     ```

3. **Action Execution:**
   - The Main process invokes the requested Stagehand method (e.g., `page.act({ action: prompt.instruction })`).
   - Stagehand's internal loop begins:
     - It captures the current DOM tree.
     - Sends the DOM and the instruction to the LLM.
     - Receives the next action (e.g., click an element, type text).
     - Executes the Playwright command on the active `page`.
   - *Because the Electron `desktopCapturer` is actively recording the `page`'s window, the Controller sees these actions happen in real-time on their video stream.*

4. **Completion:**
   - When Stagehand finishes the task (or extract/observe returns a result), the Promise resolves.
   - Main process emits `AGENT_STATUS_UPDATE` (state: `completed`, result: `data`).

### 6.2 The Takeover Interrupt (Human-in-the-Loop)

Stagehand executes actions asynchronously. If the Controller decides the agent is making a mistake, they click "Takeover", emitting a `TAKEOVER_REQUEST`.

**Interrupt Handling:**
- Stagehand does not currently have a native "pause/resume" API during an active `.act()` call.
- **Implementation Strategy:**
  1. Set a global `isTakeoverActive = true` flag in the Main process.
  2. We will utilize Playwright's `page.route` or intercept navigation/clicks at the Playwright level to block Stagehand's programmatic actions while `isTakeoverActive` is true, OR we accept that the current step might finish, but we throw a specific "TakeoverAbortError" to gracefully terminate the current `page.act()` promise.
  3. Emit `AGENT_STATUS_UPDATE` (state: `paused`).
  4. The Host Main process now listens exclusively to `REMOTE_INPUT_MOUSE` and `REMOTE_INPUT_KEYBOARD` payloads and translates them into Playwright `page.mouse` and `page.keyboard` events, allowing the human to manually navigate.
  5. Upon receiving `TAKEOVER_RELEASE`, `isTakeoverActive` is set to false. The Controller can then submit a *new* `AGENT_PROMPT` to resume agentic control from the newly established browser state.

---

## 7. Workflows & Autonomous Local Mode

### 7.1 Workflow Payload & Execution
A "Workflow" is an array of instructions. In Remote Mode, the Controller can push a batch of instructions to the Host using a new Data Channel message type: `AGENT_WORKFLOW_BATCH`.

```typescript
// type: AGENT_WORKFLOW_BATCH
interface AgentWorkflowPayload {
  workflowId: string;
  startUrl: string;
  steps: { action: 'act' | 'extract' | 'observe', instruction: string }[];
}
```
The Host's Main process receives this batch, queues it, and executes the `steps` sequentially via Stagehand, emitting `AGENT_STATUS_UPDATE` events as each step completes.

### 7.2 Link Sharing (Autonomous Local Mode)
Users can share a workflow via a deep link. This uses a Cloud Registry to map a UUID to the JSON payload.
1. **Creation:** App POSTs `AgentWorkflowPayload` to `api.RemoteCtrl.app/workflows` -> receives ID `abc-123`.
2. **Deep Link:** `RemoteCtrl://workflow/abc-123`
3. **Execution (`app.on('open-url')`):**
   - Electron intercepts the URI on startup.
   - It bypasses the Host/Controller selection screen.
   - It fetches the JSON from the Cloud Registry.
   - It immediately launches a visible Playwright browser locally on the user's machine and begins executing the steps.

---

## 8. API Key Management & Autonomous Safety

API key configuration must adhere to the **"Execution Environment Pays"** rule. To prevent key exfiltration, the Controller can NEVER pass their API keys over the network to the Host.

1. **Autonomous Local Mode:** Execution happens on the link-clicker's machine. The App will attempt to read the local `.env` or settings. If missing, it halts execution and prompts: *"Please enter your OpenAI key to run this workflow."* 
   - **Mandatory Review:** Before any autonomous execution begins, the app MUST display a modal listing all steps and require the user to explicitly click "Execute".
2. **Remote Host Mode:** Execution happens on the Host. The Stagehand initialization uses the Host's locally stored API key exclusively. If the Host does not have a key, agent commands will fail.
