import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useConnectionStore } from './stores/useConnectionStore';
import { useAgentStore } from './stores/useAgentStore';
import { Home } from './screens/Home';
import { HostSession } from './screens/HostSession';
import { ControllerSession } from './screens/ControllerSession';
import { Settings } from './screens/Settings';
import { WorkflowLibrary } from './screens/WorkflowLibrary';
import { WorkflowEditor } from './screens/WorkflowEditor';

export default function App() {
  const { setHostState, setControllerState, setPendingControllerId, setPin, setError } =
    useConnectionStore();
  const { handleAgentStatus, handleAgentLog } = useAgentStore();

  // Wire Main -> Renderer push events
  useEffect(() => {
    if (!window.remconAPI) return; // Running in browser dev mode without Electron

    const unsubs = [
      window.remconAPI.on.hostStateChange((state) => {
        window.remconAPI.debugLog(`[app] hostState → ${state}`);
        setHostState(state);
      }),
      window.remconAPI.on.controllerStateChange((state) => {
        window.remconAPI.debugLog(`[app] controllerState → ${state}`);
        setControllerState(state);
      }),
      window.remconAPI.on.controllerJoinRequest((id) => setPendingControllerId(id)),
      window.remconAPI.on.pin((pin) => setPin(pin)),
      window.remconAPI.on.agentStatus((payload) => handleAgentStatus(payload)),
      window.remconAPI.on.agentLog((payload) => handleAgentLog(payload)),
      window.remconAPI.on.error((msg) => setError(msg)),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/host" element={<HostSession />} />
      <Route path="/controller" element={<ControllerSession />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/workflows" element={<WorkflowLibrary />} />
      <Route path="/workflows/new" element={<WorkflowEditor />} />
      <Route path="/workflows/:id" element={<WorkflowEditor />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
