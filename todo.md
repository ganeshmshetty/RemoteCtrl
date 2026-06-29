# RemoteCtrl TODO List

## 🔴 Critical Bugs
- [x] **Routing mismatch on host side**: Checkpoint responses and workflow runs currently route via WebRTC (`sendData`) but the host expects them via IPC (`browser:submitCheckpoint` / `browser:startWorkflow`). This causes agent deadlocks on checkpoints on the host side.
- [x] **"Save as Workflow" button is broken**: The button in `AgentPanel.tsx` has no `onClick` handler.
- [x] **Duplicate event listeners leak**: `onMessage` in `BrowserPanel.tsx` is called inline during render, creating duplicate listeners on every render cycle. Wrap it in `useEffect`.
- [x] **Windows config path issue**: `human-checkpoint.ts` uses `~/.config/RemoteCtrl` (Linux/macOS style). Update it to use `app.getPath('userData')`.
- [x] **Missing single-instance lock**: Two instances of the app can run simultaneously. Add `app.requestSingleInstanceLock()` in `index.ts`.

## 🟡 Medium Priority (UX / Performance)
- [ ] **Blocking Sync I/O**: `storage.ts` uses `readFileSync` on every getter call. Add an in-memory cache to prevent blocking the main thread on every IPC call.
- [ ] **Non-reactive PIN display**: `BrowserPanel.tsx` uses `useConnectionStore.getState().pin` which is a snapshot. Change to a reactive `const { pin } = useConnectionStore()`.
- [ ] **Missing Zod validation**: `ipcMain.handle('settings:setBrowserMode')` casts `mode as any` instead of using Zod schema.
- [ ] **No API request timeout**: `settings:fetchModels` in `ipc-handlers.ts` has no timeout, which could freeze the IPC call indefinitely.
- [ ] **Hidden stall warnings**: Stall nudge messages from `stall-detector.ts` are logged but not shown to the user in the UI.
- [ ] **Workflow Editor**: Add drag-and-drop step reordering support for better UX.

## 🟢 Low Priority / Cleanup (Tech Debt)
- [ ] **Dead Code (Logs & Context)**: `conversation-manager.ts` and `execution-logger.ts` are fully implemented but never imported. Wire them into `agent-executor.ts` to prevent context window limits and enable debugging logs.
- [ ] **Dead Code (Orchestration)**: `task-planner.ts`, `advanced-task-executor.ts`, and `complex-task-executor.ts` are dead paths. Consolidate them and wire them into `browser:startAgent` or remove them.
- [ ] **Unused Error Classes**: Remove or use `BrowserNotReadyError` and `StagehandConnectionError` in `errors.ts`.
- [ ] **API Key Security**: Keys are currently stored in plain JSON in `storage.ts`. Move them to the OS keychain using `electron.safeStorage` or `keytar`.
- [x] **Missing Native Menu**: Add a native application menu (especially for macOS so it doesn't just say "Electron", and to enable copy/paste everywhere).
- [ ] **Hardcoded New Tab URL**: `newTab()` in `browser-manager.ts` hardcodes `https://google.com`.
- [ ] **LLM Provider Support**: `task-evaluator.ts` only supports OpenAI, Anthropic, and Gemini. Add support for the remaining providers.
- [x] **Settings UI**: Open settings as an in-app modal (like `WorkflowEditorModal`) instead of a separate `BrowserWindow`.
