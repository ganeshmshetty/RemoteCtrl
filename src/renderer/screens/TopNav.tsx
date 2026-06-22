import { Settings } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';

export function TopNav() {
  const { hostState, controllerState, pin, reset } = useConnectionStore();

  const isConnected = 
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    hostState === 'WAITING_FOR_CONTROLLER' ||
    hostState === 'AWAITING_HOST_APPROVAL' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  function handleDisconnect() {
    if (window.RemoteCtrlAPI) {
      if (hostState !== 'IDLE') {
        window.RemoteCtrlAPI.host.stop();
      }
      if (controllerState !== 'IDLE') {
        window.RemoteCtrlAPI.controller.disconnect();
      }
    }
    reset();
  }

  function handleOpenSettings() {
    window.RemoteCtrlAPI?.app.openSettings();
  }

  return (
    <div className="top-nav">
      <div className="top-nav-left drag-region">
      </div>
      <div className="top-nav-right no-drag">
        {isConnected ? (
          <div className="connection-pill">
            <div className="connection-pill-dot connected"></div>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{pin}</span>
            <button 
              className="disconnect-btn"
              onClick={handleDisconnect}
              title="Disconnect"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="connection-pill" style={{ opacity: 0.7 }}>
            <div className="connection-pill-dot"></div>
            <span>Not connected</span>
          </div>
        )}
        <button className="icon-btn" onClick={handleOpenSettings} title="Settings">
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
