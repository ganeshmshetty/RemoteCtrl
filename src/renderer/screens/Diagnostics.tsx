import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, CheckCircle2, XCircle, Settings2, Info } from 'lucide-react';
import type { AppDiagnostics } from '../../shared/types';

export function Diagnostics() {
  const navigate = useNavigate();
  const [data, setData] = useState<AppDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      if (window.RemoteCtrlAPI) {
        const d = await window.RemoteCtrlAPI.app.getDiagnostics();
        setData(d);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="diag-root">
      <div className="drag-region diag-titlebar" />

      <div className="diag-header no-drag">
        <button className="icon-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </button>
        <h1 className="diag-title">System Diagnostics</h1>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          <Activity size={14} className={loading ? "animate-pulse" : ""} />
          Refresh
        </button>
      </div>

      <div className="diag-body">
        {data ? (
          <div className="diag-grid">

            {/* Status Section */}
            <div className="diag-card">
              <h2 className="diag-card-title"><Settings2 size={14} /> Subsystems</h2>
              <div className="diag-list">
                <StatusItem label="Signaling Server" ok={data.signalingConnected} detail={data.signalingRole ? `Role: ${data.signalingRole}` : 'Disconnected'} />
                <StatusItem label="Host Browser" ok={data.browserRunning} />
                <StatusItem label="Agent Status" ok={!data.agentRunning} detail={data.agentRunning ? 'Running' : 'Idle'} invertOk />
                <StatusItem label="Workflow Engine" ok={!data.workflowRunning} detail={data.workflowRunning ? 'Running' : 'Idle'} invertOk />
              </div>
            </div>

            {/* Providers Section */}
            <div className="diag-card">
              <h2 className="diag-card-title"><Settings2 size={14} /> AI Providers</h2>
              <div className="diag-list">
                <StatusItem label="OpenAI (GPT-4o)" ok={data.hasOpenAIKey} />
                <StatusItem label="Anthropic (Claude)" ok={data.hasAnthropicKey} />
                <StatusItem label="Gemini" ok={data.hasGeminiKey} />
                <div className="diag-item">
                  <span className="diag-item-label">Preferred Provider</span>
                  <span className="diag-item-value">{data.preferredProvider}</span>
                </div>
              </div>
            </div>

            {/* System Section */}
            <div className="diag-card">
              <h2 className="diag-card-title"><Info size={14} /> System Info</h2>
              <div className="diag-list">
                <div className="diag-item">
                  <span className="diag-item-label">Platform</span>
                  <span className="diag-item-value">{data.platform}</span>
                </div>
                <div className="diag-item">
                  <span className="diag-item-label">App Version</span>
                  <span className="diag-item-value">v{data.appVersion}</span>
                </div>
                <div className="diag-item">
                  <span className="diag-item-label">Electron</span>
                  <span className="diag-item-value">v{data.electronVersion}</span>
                </div>
                <div className="diag-item">
                  <span className="diag-item-label">Node.js</span>
                  <span className="diag-item-value">v{data.nodeVersion}</span>
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div className="diag-loading">Loading diagnostics…</div>
        )}
      </div>

      <style>{`
        .diag-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
        }
        .diag-titlebar { height: 28px; }
        .diag-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border);
        }
        .diag-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          flex: 1;
        }
        .diag-body {
          flex: 1;
          overflow-y: auto;
          padding: 24px 20px;
        }
        .diag-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          max-width: 900px;
        }
        .diag-card {
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          padding: 16px;
        }
        .diag-card-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          margin-bottom: 16px;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--border);
        }
        .diag-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .diag-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 13px;
        }
        .diag-item-label { color: var(--text-secondary); }
        .diag-item-value { color: var(--text-primary); font-family: var(--font-mono); font-size: 12px; }
        .diag-item-status {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 500;
        }
        .diag-status-ok { color: var(--success); }
        .diag-status-err { color: var(--danger); }
        .diag-status-neutral { color: var(--text-muted); }
        .diag-loading {
          color: var(--text-muted);
          font-size: 13px;
        }
        .icon-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: var(--radius-sm);
          border: none; background: transparent; color: var(--text-muted);
          cursor: pointer; transition: color var(--transition), background var(--transition);
        }
        .icon-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; height: 32px; padding: 0 12px; border-radius: var(--radius-sm);
          font-size: 12px; font-weight: 600; cursor: pointer; border: none;
          transition: background var(--transition), color var(--transition);
        }
        .btn-ghost { background: transparent; color: var(--text-secondary); }
        .btn-ghost:hover:not(:disabled) { background: var(--bg-overlay); color: var(--text-primary); }
      `}</style>
    </div>
  );
}

function StatusItem({ label, ok, detail, invertOk }: { label: string; ok: boolean; detail?: string; invertOk?: boolean }) {
  // invertOk means ok=true is shown as neutral/blue, ok=false is shown as active/running (which is fine, not an error usually, but distinct)
  let okClass = ok ? 'diag-status-ok' : 'diag-status-err';
  if (invertOk) {
    okClass = ok ? 'diag-status-neutral' : 'diag-status-ok'; // running = green, idle = gray
  }

  return (
    <div className="diag-item">
      <span className="diag-item-label">{label}</span>
      <div className={`diag-item-status ${okClass}`}>
        {detail ? <span>{detail}</span> : null}
        {ok ? (
          <CheckCircle2 size={14} className={invertOk ? '' : 'diag-status-ok'} />
        ) : (
          <XCircle size={14} className={invertOk ? 'diag-status-ok' : 'diag-status-err'} />
        )}
      </div>
    </div>
  );
}
