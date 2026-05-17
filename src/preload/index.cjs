// preload.cjs — CommonJS because Electron preload runs before ESM is available
// This is the ONLY communication bridge between renderer and main.

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose narrow typed API to renderer.
 * Never expose raw ipcRenderer — only specific, named channels.
 */
contextBridge.exposeInMainWorld('remconAPI', {
  // ── Host Controls ──────────────────────────────────────────────────────────
  host: {
    start: () => ipcRenderer.invoke('host:start'),
    stop: () => ipcRenderer.invoke('host:stop'),
    approveController: (controllerId) =>
      ipcRenderer.invoke('host:approveController', controllerId),
    rejectController: (controllerId) =>
      ipcRenderer.invoke('host:rejectController', controllerId),
  },

  // ── Controller Controls ───────────────────────────────────────────────────
  controller: {
    connect: (pin) => ipcRenderer.invoke('controller:connect', pin),
    disconnect: () => ipcRenderer.invoke('controller:disconnect'),
  },

  // ── Browser Controls ──────────────────────────────────────────────────────
  browser: {
    launch: (startUrl) => ipcRenderer.invoke('browser:launch', startUrl),
    close: () => ipcRenderer.invoke('browser:close'),
    getSources: () => ipcRenderer.invoke('browser:getSources'),
    resetProfile: () => ipcRenderer.invoke('browser:resetProfile'),
  },

  // ── WebRTC Signal Relay ───────────────────────────────────────────────────
  webrtc: {
    sendSignal: (signal) => ipcRenderer.invoke('webrtc:sendSignal', signal),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    hasApiKey: (provider) => ipcRenderer.invoke('settings:hasApiKey', provider),
    setApiKey: (provider, value) =>
      ipcRenderer.invoke('settings:setApiKey', provider, value),
    getSignalingUrl: () => ipcRenderer.invoke('settings:getSignalingUrl'),
    setSignalingUrl: (url) => ipcRenderer.invoke('settings:setSignalingUrl', url),
    getPreferredProvider: () => ipcRenderer.invoke('settings:getPreferredProvider'),
    setPreferredProvider: (provider) =>
      ipcRenderer.invoke('settings:setPreferredProvider', provider),
  },

  // ── Workflows ─────────────────────────────────────────────────────────────
  workflows: {
    list: () => ipcRenderer.invoke('workflows:list'),
    save: (workflow) => ipcRenderer.invoke('workflows:save', workflow),
    delete: (workflowId) => ipcRenderer.invoke('workflows:delete', workflowId),
  },

  // ── Event Listeners (Main -> Renderer push) ───────────────────────────────
  // Returns an unsubscribe function so components can clean up on unmount.
  on: {
    hostStateChange: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on('host:stateChange', listener);
      return () => ipcRenderer.removeListener('host:stateChange', listener);
    },
    controllerStateChange: (cb) => {
      const listener = (_event, state) => cb(state);
      ipcRenderer.on('controller:stateChange', listener);
      return () => ipcRenderer.removeListener('controller:stateChange', listener);
    },
    controllerJoinRequest: (cb) => {
      const listener = (_event, controllerId) => cb(controllerId);
      ipcRenderer.on('controller:joinRequest', listener);
      return () => ipcRenderer.removeListener('controller:joinRequest', listener);
    },
    pin: (cb) => {
      const listener = (_event, pin) => cb(pin);
      ipcRenderer.on('host:pin', listener);
      return () => ipcRenderer.removeListener('host:pin', listener);
    },
    agentStatus: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('agent:status', listener);
      return () => ipcRenderer.removeListener('agent:status', listener);
    },
    agentLog: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('agent:log', listener);
      return () => ipcRenderer.removeListener('agent:log', listener);
    },
    error: (cb) => {
      const listener = (_event, message) => cb(message);
      ipcRenderer.on('app:error', listener);
      return () => ipcRenderer.removeListener('app:error', listener);
    },
    webrtcSignal: (cb) => {
      const listener = (_event, signal) => cb(signal);
      ipcRenderer.on('webrtc:signal', listener);
      return () => ipcRenderer.removeListener('webrtc:signal', listener);
    },
    captureMetadata: (cb) => {
      const listener = (_event, meta) => cb(meta);
      ipcRenderer.on('browser:captureMetadata', listener);
      return () => ipcRenderer.removeListener('browser:captureMetadata', listener);
    },
  },
});
