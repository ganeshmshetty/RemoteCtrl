# RemoteCtrl UI/UX Architecture & State Management

This document defines the visual layout, component hierarchy, styling aesthetic, and state management strategy for the RemoteCtrl Electron application.

## 1. Aesthetic & UI Stack

The application will feature a modern, minimalist aesthetic akin to developer tools like Linear or Vercel.

-   **Styling:** Tailwind CSS.
-   **Component Library:** `shadcn/ui` (accessible, customizable, headless components).
-   **Theme:** Dark mode by default (with seamless light mode support).
-   **Icons:** Lucide Icons.

## 2. Global Layout & Component Hierarchy

The application has three primary screens routed via a simple hash or memory router (as this is a desktop app).

### 2.1 Screen 1: The Bootstrapper (Home)
The entry point of the application.
-   **Layout:** A centered, clean card layout.
-   **Components:**
    -   `HostButton`: Initiates Mode A (Generates PIN).
    -   `ConnectForm`: A 9-digit PIN input with a submit button (Initiates Mode B).
    -   `SettingsGear`: Top-right corner, opens an overlay for API keys.

### 2.2 Screen 2: Host View (Mode A)
What the person sharing their browser sees.
-   **Layout:** A small, floating "always-on-top" widget (Electron configuration).
-   **Components:**
    -   `PinDisplay`: Large text showing the 9-digit PIN.
    -   `ConnectionStatus`: "Waiting for controller..." -> "Connected".
    -   `StopSharingButton`: Instantly kills the WebRTC stream and closes the local Playwright instance.
    -   *Note: The actual Playwright browser window is managed by the Main process and is visually distinct from this Electron UI widget.*

### 2.3 Screen 3: Controller Dashboard (Mode B)
The core interface for the pilot. It uses an **"IDE Split-Pane"** layout.

**Left Pane (75% width): Video & Input Surface**
-   `VideoPlayer`: The WebRTC `<video>` element. Must be unstyled to ensure exact 1:1 coordinate mapping when clicked.
-   `TakeoverOverlay`: An invisible absolute-positioned `div` layered precisely over the `VideoPlayer`. It is strictly active only when `isTakeoverMode === true` to capture local mouse/keyboard events.

**Right Pane (25% width): The Command Sidebar**
A fixed-width sidebar containing a Tab interface.
-   **Tab 1: Chat (Ad-Hoc Control)**
    -   `ChatHistory`: A scrolling list of User Prompts (right-aligned) and Agent Status/Logs (left-aligned).
    -   `PromptInput`: A sticky text area at the bottom for typing natural language commands.
-   **Tab 2: Workflows**
    -   `WorkflowList`: A list of saved workflows.
    -   `RunButton`: Pushes the selected workflow batch over WebRTC.
    -   `ShareButton`: Triggers the Cloud Registry upload and returns a deep link.

**Top Bar (Header)**
-   `SessionStatus`: Ping/Latency indicator.
-   `TakeoverToggle`: A prominent, styled button (e.g., Red when active) to instantly switch between Agent Control and Human Control.

## 3. State Management (Zustand)

To prevent the 60fps WebRTC video stream and high-frequency coordinate tracking from lagging the Chat UI, we will use **Zustand** and strictly separate our stores. React components will only subscribe to the slices of state they need.

### Store 1: `useConnectionStore`
Manages the signaling and WebRTC lifecycle.
```typescript
interface ConnectionState {
  role: 'idle' | 'host' | 'controller';
  pin: string | null;
  status: 'disconnected' | 'signaling' | 'webrtc_connecting' | 'connected';
  remoteStream: MediaStream | null;
  
  // Actions
  setRole: (role: Role) => void;
  connectToSignaling: (pin?: string) => Promise<void>;
  disconnect: () => void;
}
```

### Store 2: `useAgentStore`
Manages the AI execution state and chat history. Changes here update the Sidebar, but *never* cause the VideoPlayer to re-render.
```typescript
interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  type: 'prompt' | 'status' | 'log';
  text: string;
  timestamp: number;
}

interface AgentState {
  isTakeoverActive: boolean;
  agentStatus: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  chatHistory: ChatMessage[];
  
  // Actions
  sendPrompt: (instruction: string) => void;
  pushWorkflow: (workflowId: string) => void;
  toggleTakeover: (active: boolean) => void;
  appendLog: (log: ChatMessage) => void;
}
```

### Store 3: `useSettingsStore` (Persisted)
Manages local configuration, persisted to disk (e.g., via `zustand/middleware/persist`).
```typescript
interface SettingsState {
  openAIApiKey: string | null;
  anthropicApiKey: string | null;
  theme: 'dark' | 'light';
  savedWorkflows: SharedWorkflow[]; // Local library
  
  // Actions
  setApiKey: (provider: string, key: string) => void;
  saveWorkflow: (workflow: SharedWorkflow) => void;
}
```

## 4. UI Rendering Optimization Rules

1.  **Video Independence:** The `VideoPlayer` component must **only** subscribe to `useConnectionStore(state => state.remoteStream)`. It must be wrapped in `React.memo()`.
2.  **Input Throttling:** When `TakeoverOverlay` captures mouse moves, it must *not* update React state. It should directly fire the WebRTC Data Channel `send()` method. Throttling mouse move events to ~30-60Hz via `lodash.throttle` is required to prevent overflowing the Data Channel.
3.  **Coordinate Mapping:** The UI must calculate the exact `xPercent` and `yPercent` based on the `TakeoverOverlay`'s bounding client rect, ignoring the video's actual resolution.
