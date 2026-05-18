# Electron Security & Cross-Platform Permissions

Because RemoteCtrl operates a browser via AI and streams screens peer-to-peer, strict security boundaries and explicit OS-level permissions are mandatory. This document defines the security architecture for multi-device deployment.

## 1. Electron IPC & Context Isolation

The application strictly separates the UI (Renderer) from the OS/Browser logic (Main) to prevent malicious web payloads from compromising the system.

### 1.1 Renderer Process (The React UI)
- **Node Integration:** `nodeIntegration: false` (Mandatory).
- **Context Isolation:** `contextIsolation: true` (Mandatory).
- **Web Security:** `webSecurity: true`.
- **Function:** The Renderer *only* handles UI rendering and the WebRTC `simple-peer` connection. It has zero direct access to the file system, Playwright, or Stagehand.

### 1.2 The Preload Bridge (`contextBridge`)
The Preload script is the ONLY way the UI communicates with the Main process.

```typescript
// preload.ts
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('RemoteCtrlAPI', {
  // Host Controls
  startStagehand: (payload) => ipcRenderer.invoke('start-stagehand', payload),
  injectMouse: (coords) => ipcRenderer.send('inject-mouse', coords),
  injectKeyboard: (keyEvent) => ipcRenderer.send('inject-keyboard', keyEvent),
  
  // Events from Main
  onAgentStatus: (callback) => ipcRenderer.on('agent-status', (_event, data) => callback(data)),
});
```

### 1.3 Main Process (The Engine)
- **Function:** Runs Playwright, Stagehand, and handles deep link URL parsing.
- **IPC Validation Layer:** The Main process MUST validate every incoming IPC payload using a schema validator (e.g., Zod) before acting on it.
- **Session State Enforcement:** Main must ensure `injectMouse` or `injectKeyboard` calls are ONLY processed when a session is active and `isTakeoverActive` is true.

---

## 2. Multi-Device OS Permissions

Handling OS privileges gracefully across platforms is critical for the "Host" mode.

### 2.1 macOS (The Strictest Environment)
- **Screen Recording (Required for `desktopCapturer`):**
  - The app must request permission the *first time* the user clicks "Host".
  - We must use `systemPreferences.getMediaAccessStatus('screen')` to check status. If denied, we must show a custom UI guiding the user to macOS System Settings (Privacy & Security -> Screen Recording).
- **Accessibility:** Not required for Phase 1, as we are only injecting clicks into our own spawned Playwright window, not the global OS.

### 2.2 Windows
- **Screen Capture:** Usually works silently via `desktopCapturer`.
- **Firewall:** The initial Signaling Server connection may trigger a standard Windows Defender Firewall prompt requesting network access.

### 2.3 Linux (Wayland vs. X11)
- **Wayland (Modern default):** Electron's `desktopCapturer` uses XDG Desktop Portal. When the user clicks "Host", the OS will naturally pop up a native system dialog asking the user which screen/window to share. We cannot bypass this.
- **X11 (Legacy):** `desktopCapturer` works seamlessly without prompts.

---

## 3. Threat Model & Policy Decisions

Based on design decisions, the following security policies are enforced:

### 3.1 The "Link Clicker" Exploit (Autonomous Mode)
**Policy: Mandatory Review Modal**
- Autonomous mode will NEVER run silently or instantly.
- When a deep link is opened, the app MUST halt and display a modal: *"This workflow wants to execute [X] steps. Review the steps below."*
- Bypassing the selection screen only takes the user to this Review Modal, not directly to execution.

### 3.2 API Key Protection
**Policy: Host Strict Liability**
- To eliminate exfiltration risk, the "Controller Override" feature is **removed**.
- **The Host machine must ALWAYS provide the API key.** The Controller cannot send their key over the network. 
- Host users must be notified that a Controller can see the results of any agent execution.

### 3.3 File Downloads
**Policy: Unrestricted for MVP**
- For the initial MVP, we are not actively blocking downloads via Playwright interception. The user assumes the standard risks of operating a browser.
