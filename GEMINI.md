# RemoteCtrl

Remote browser control desktop app — Electron + React + TypeScript.

## Architecture

```
src/
  main/         Electron main process (Node.js)
    index.ts    App lifecycle, window creation
    storage.ts  Settings + workflow file storage
    ipc-handlers.ts  All IPC handler registrations
  preload/
    index.cjs   contextBridge API (renderer ↔ main)
  renderer/     React UI (browser context)
    main.tsx    Entry point
    App.tsx     Router + event wiring
    screens/    Home, HostSession, ControllerSession, Settings, WorkflowLibrary, WorkflowEditor
    stores/     Zustand stores (connection, agent, workflow, settings)
    index.css   Global CSS with design tokens
  shared/
    types.ts    Shared TypeScript types
    schemas.ts  Zod validation schemas for all IPC payloads
```

## Development

```bash
# Install dependencies
npm install

# Run renderer only (browser dev mode)
npm run dev:renderer

# Build main process
npm run build:main

# Run full Electron app (requires renderer to be built or dev server running)
npm run dev

# Typecheck renderer
npx tsc --project tsconfig.app.json --noEmit

# Typecheck main process
npx tsc --project tsconfig.main.json --noEmit

# Build everything
npm run build
```

## Implementation Status

- **Phase 0** ✅ Project skeleton, routing, settings storage, workflow storage
- **Phase 1** ✅ Socket.io signaling, PIN registration, session state, host approval
- **Phase 2** ✅ Playwright browser launch, capture, WebRTC streaming
- **Phase 3** ⬜ Manual takeover, coordinate mapping
- **Phase 4** ⬜ Agent prompt execution (Stagehand)
- **Phase 5** ⬜ Remote workflow runs
- **Phase 6** ⬜ Hardening, packaging

## Key Constraints

- Renderer never accesses Node APIs directly — only through `window.RemoteCtrlAPI`
- All IPC payloads validated with Zod in main process before use
- API keys stored in `~/.config/RemoteCtrl/api-keys.json` (never in renderer state)
- Workflows stored in `~/.config/RemoteCtrl/workflows.json`
- Settings stored in `~/.config/RemoteCtrl/settings.json`
