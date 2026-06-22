import { useEffect, useState } from 'react';
import { useConnectionStore } from './stores/useConnectionStore';
import { useAgentStore } from './stores/useAgentStore';
import { TopNav } from './screens/TopNav';
import { ControllerSession } from './screens/ControllerSession';
import { Settings } from './screens/Settings';

export default function App() {
  const { setHostState, setControllerState, setPendingControllerId, setPin, setError } =
    useConnectionStore();
  const { handleAgentStatus, handleAgentLog, handleWorkflowRunStatus, handleWorkflowStepStatus, handleAgentCheckpoint } = useAgentStore();
  const [isSettingsRoute, setIsSettingsRoute] = useState(false);

  useEffect(() => {
    setIsSettingsRoute(window.location.hash.includes('settings'));
    const handleHashChange = () => setIsSettingsRoute(window.location.hash.includes('settings'));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);
  // Wire Main -> Renderer push events
  useEffect(() => {
    if (!window.RemoteCtrlAPI) return; // Running in browser dev mode without Electron

    const unsubs = [
      window.RemoteCtrlAPI.on.hostStateChange((state) => setHostState(state)),
      window.RemoteCtrlAPI.on.controllerStateChange((state) => setControllerState(state)),
      window.RemoteCtrlAPI.on.controllerJoinRequest((id) => setPendingControllerId(id)),
      window.RemoteCtrlAPI.on.pin((pin) => setPin(pin)),
      window.RemoteCtrlAPI.on.agentStatus((payload) => handleAgentStatus(payload)),
      window.RemoteCtrlAPI.on.agentLog((payload) => handleAgentLog(payload)),
      window.RemoteCtrlAPI.on.workflowRunStatus((status) => handleWorkflowRunStatus(status)),
      window.RemoteCtrlAPI.on.workflowStepStatus((status) => handleWorkflowStepStatus(status)),
      window.RemoteCtrlAPI.on.agentCheckpoint((payload) => handleAgentCheckpoint(payload)),
      window.RemoteCtrlAPI.on.error((msg) => setError(msg)),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  if (isSettingsRoute) {
    return <Settings />;
  }

  return (
    <div className="app-shell">
      <TopNav />
      <div className="main-content">
        <ControllerSession />
      </div>
    </div>
  );
}
