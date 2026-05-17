import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, StopCircle, Users, CheckCircle, XCircle } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';

const STATE_LABELS: Record<string, string> = {
  IDLE: 'Idle',
  CHECKING_PERMISSIONS: 'Checking permissions…',
  LAUNCHING_BROWSER: 'Launching browser…',
  REGISTERING_PIN: 'Registering session…',
  WAITING_FOR_CONTROLLER: 'Waiting for controller…',
  AWAITING_HOST_APPROVAL: 'Approve connection?',
  WEBRTC_CONNECTING: 'Establishing connection…',
  SESSION_ACTIVE: 'Session active',
  AGENT_EXECUTING: 'Agent running…',
  CANCELLING_AGENT: 'Cancelling agent…',
  HUMAN_TAKEOVER: 'Human takeover active',
  DISCONNECTED: 'Disconnected',
};

export function HostSession() {
  const navigate = useNavigate();
  const {
    hostState,
    pin,
    pendingControllerId,
    error,
    reset,
  } = useConnectionStore();

  useEffect(() => {
    // Trigger host start on mount
    window.remconAPI?.host.start();
    return () => {
      // Cleanup handled by stop button or disconnect
    };
  }, []);

  async function handleStop() {
    await window.remconAPI?.host.stop();
    reset();
    navigate('/');
  }

  async function handleApprove() {
    if (!pendingControllerId) return;
    await window.remconAPI?.host.approveController(pendingControllerId);
    useConnectionStore.getState().setPendingControllerId(null);
  }

  async function handleReject() {
    if (!pendingControllerId) return;
    await window.remconAPI?.host.rejectController(pendingControllerId);
    useConnectionStore.getState().setPendingControllerId(null);
  }

  const isActive = hostState === 'SESSION_ACTIVE' || hostState === 'AGENT_EXECUTING' || hostState === 'HUMAN_TAKEOVER';
  const isWaiting = hostState === 'WAITING_FOR_CONTROLLER';
  const stateLabel = STATE_LABELS[hostState] ?? hostState;

  return (
    <div className="session-root">
      <div className="drag-region session-titlebar" />

      <div className="session-center">
        <div className="session-card animate-fade-in">
          {/* Header */}
          <div className="session-header">
            <div className="session-header-icon">
              <Monitor size={20} />
            </div>
            <div>
              <div className="session-header-title">Host Session</div>
              <div className="session-header-sub">Your browser is being shared</div>
            </div>
          </div>

          {/* PIN display */}
          {pin && (
            <div className="session-pin-section">
              <div className="session-pin-label">Share this PIN</div>
              <div className="session-pin">
                {pin.slice(0, 3)}&nbsp;{pin.slice(3, 6)}&nbsp;{pin.slice(6, 9)}
              </div>
              <div className="session-pin-hint">PIN expires in 10 minutes</div>
            </div>
          )}

          {/* Status */}
          <div className="session-status-row">
            <div className={`session-status-dot ${isActive ? 'dot-green' : isWaiting ? 'dot-pulse' : 'dot-dim'}`} />
            <span className="session-status-text">{stateLabel}</span>
          </div>

          {/* Approval modal */}
          {pendingControllerId && hostState === 'AWAITING_HOST_APPROVAL' && (
            <div className="session-approval animate-fade-in">
              <div className="session-approval-title">
                <Users size={16} /> Controller wants to connect
              </div>
              <div className="session-approval-id">{pendingControllerId}</div>
              <div className="session-approval-actions">
                <button className="btn btn-danger-outline" onClick={handleReject}>
                  <XCircle size={14} /> Reject
                </button>
                <button className="btn btn-success" onClick={handleApprove}>
                  <CheckCircle size={14} /> Approve
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="session-error animate-fade-in">{error}</div>
          )}

          {/* Stop button */}
          <button className="btn btn-danger session-stop-btn" onClick={handleStop}>
            <StopCircle size={15} />
            Stop sharing
          </button>
        </div>
      </div>

      <style>{`
        .session-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
        }
        .session-titlebar { height: 28px; }
        .session-center {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }
        .session-card {
          width: 100%;
          max-width: 400px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .session-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .session-header-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius);
          background: var(--accent-glow);
          border: 1px solid rgba(124,106,247,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }
        .session-header-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .session-header-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .session-pin-section {
          background: var(--bg-overlay);
          border-radius: var(--radius);
          padding: 20px;
          text-align: center;
        }
        .session-pin-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          margin-bottom: 10px;
        }
        .session-pin {
          font-family: var(--font-mono);
          font-size: 36px;
          font-weight: 700;
          letter-spacing: 0.12em;
          color: var(--accent);
        }
        .session-pin-hint {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 8px;
        }
        .session-status-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .session-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .dot-green  { background: var(--success); }
        .dot-pulse  { background: var(--accent); animation: pulse-ring 1.5s ease-out infinite; }
        .dot-dim    { background: var(--text-muted); }
        .session-status-text {
          font-size: 13px;
          color: var(--text-secondary);
        }
        .session-approval {
          background: var(--bg-overlay);
          border: 1px solid var(--border-active);
          border-radius: var(--radius);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .session-approval-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .session-approval-id {
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-base);
          padding: 4px 8px;
          border-radius: 4px;
        }
        .session-approval-actions {
          display: flex;
          gap: 8px;
        }
        .session-error {
          background: rgba(239,68,68,0.1);
          border: 1px solid rgba(239,68,68,0.3);
          border-radius: var(--radius-sm);
          padding: 10px 14px;
          font-size: 13px;
          color: var(--danger);
        }
        .session-stop-btn { align-self: flex-start; }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; height: 36px; padding: 0 16px; border-radius: var(--radius-sm);
          font-size: 13px; font-weight: 600; cursor: pointer; border: none;
          transition: background var(--transition), opacity var(--transition), transform var(--transition);
        }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-danger { background: var(--danger); color: white; }
        .btn-danger:hover { background: #dc2626; }
        .btn-danger-outline { background: transparent; color: var(--danger); border: 1px solid rgba(239,68,68,0.4); flex: 1; }
        .btn-danger-outline:hover { background: rgba(239,68,68,0.1); }
        .btn-success { background: var(--success); color: #0a2218; flex: 1; }
        .btn-success:hover { background: #16a34a; }
      `}</style>
    </div>
  );
}
