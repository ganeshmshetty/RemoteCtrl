import { useNavigate } from 'react-router-dom';
import { Monitor, Wifi, Settings, BookOpen, Activity } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useState } from 'react';

export function Home() {
  const navigate = useNavigate();
  const { setRole } = useConnectionStore();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  function handleHost() {
    setRole('host');
    navigate('/host');
  }

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = pin.replace(/\D/g, '');
    if (cleaned.length !== 9) {
      setPinError('PIN must be exactly 9 digits');
      return;
    }
    setPinError('');
    setRole('controller');
    navigate('/controller', { state: { pin: cleaned } });
  }

  return (
    <div className="home-root">
      {/* Title bar drag region */}
      <div className="drag-region home-titlebar" />

      {/* Top right actions */}
      <div className="home-top-actions no-drag">
        <button
          className="icon-btn"
          title="Workflow Library"
          onClick={() => navigate('/workflows')}
        >
          <BookOpen size={16} />
        </button>
        <button
          className="icon-btn"
          title="Diagnostics"
          onClick={() => navigate('/diagnostics')}
        >
          <Activity size={16} />
        </button>
        <button
          className="icon-btn"
          title="Settings"
          onClick={() => navigate('/settings')}
        >
          <Settings size={16} />
        </button>
      </div>

      {/* Center card */}
      <div className="home-center">
        <div className="home-logo">
          <div className="home-logo-icon">
            <Wifi size={28} />
          </div>
          <div>
            <h1 className="home-title">RemoteCtrl</h1>
            <p className="home-subtitle">Remote browser control</p>
          </div>
        </div>

        <div className="home-cards">
          {/* Host card */}
          <button className="home-card home-card-host" onClick={handleHost}>
            <div className="home-card-icon">
              <Monitor size={24} />
            </div>
            <div className="home-card-body">
              <div className="home-card-title">Host a session</div>
              <div className="home-card-desc">
                Share your browser and let a controller connect remotely
              </div>
            </div>
            <div className="home-card-arrow">→</div>
          </button>

          {/* Divider */}
          <div className="home-divider"><span>or</span></div>

          {/* Connect form */}
          <form className="home-card home-card-connect" onSubmit={handleConnect}>
            <div className="home-card-icon">
              <Wifi size={24} />
            </div>
            <div className="home-card-body">
              <div className="home-card-title">Join a session</div>
              <div className="home-pin-row">
                <input
                  id="pin-input"
                  className={`home-pin-input ${pinError ? 'home-pin-input--error' : ''}`}
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter 9-digit PIN"
                  maxLength={9}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value.replace(/\D/g, ''));
                    setPinError('');
                  }}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={pin.length !== 9}
                >
                  Connect
                </button>
              </div>
              {pinError && <div className="home-pin-error">{pinError}</div>}
            </div>
          </form>
        </div>
      </div>

      <style>{`
        .home-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
          position: relative;
        }
        .home-titlebar {
          height: 28px;
          width: 100%;
          flex-shrink: 0;
        }
        .home-top-actions {
          position: absolute;
          top: 8px;
          right: 12px;
          display: flex;
          gap: 4px;
          z-index: 10;
        }
        .icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-sm);
          border: none;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: color var(--transition), background var(--transition);
        }
        .icon-btn:hover {
          color: var(--text-primary);
          background: var(--bg-elevated);
        }
        .home-center {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 48px;
          padding: 24px;
        }
        .home-logo {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .home-logo-icon {
          width: 56px;
          height: 56px;
          border-radius: var(--radius-lg);
          background: var(--accent-glow);
          border: 1px solid rgba(124, 106, 247, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
        }
        .home-title {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.03em;
          color: var(--text-primary);
        }
        .home-subtitle {
          font-size: 13px;
          color: var(--text-muted);
          margin-top: 2px;
        }
        .home-cards {
          width: 100%;
          max-width: 480px;
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .home-card {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 20px 24px;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          cursor: pointer;
          transition: background var(--transition), border-color var(--transition);
          text-align: left;
          width: 100%;
        }
        .home-card:first-child { border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
        .home-card:last-child  { border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
        .home-card:only-child  { border-radius: var(--radius-lg); }
        .home-card:hover {
          background: var(--bg-elevated);
          border-color: var(--border-active);
        }
        .home-card-icon {
          width: 44px;
          height: 44px;
          border-radius: var(--radius);
          background: var(--bg-overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
          flex-shrink: 0;
        }
        .home-card-body { flex: 1; }
        .home-card-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 4px;
        }
        .home-card-desc {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.4;
        }
        .home-card-arrow {
          color: var(--text-muted);
          font-size: 18px;
          transition: transform var(--transition), color var(--transition);
        }
        .home-card-host:hover .home-card-arrow {
          transform: translateX(4px);
          color: var(--text-primary);
        }
        .home-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 24px;
          background: var(--bg-surface);
          border-left: 1px solid var(--border);
          border-right: 1px solid var(--border);
        }
        .home-divider::before, .home-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }
        .home-divider span {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 8px 0;
        }
        .home-card-connect { cursor: default; }
        .home-pin-row {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
        .home-pin-input {
          flex: 1;
          height: 36px;
          padding: 0 12px;
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 15px;
          letter-spacing: 0.08em;
          outline: none;
          transition: border-color var(--transition);
        }
        .home-pin-input:focus {
          border-color: var(--accent);
        }
        .home-pin-input--error {
          border-color: var(--danger) !important;
        }
        .home-pin-error {
          font-size: 12px;
          color: var(--danger);
          margin-top: 6px;
        }
        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          height: 36px;
          padding: 0 16px;
          border-radius: var(--radius-sm);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: background var(--transition), opacity var(--transition), transform var(--transition);
          white-space: nowrap;
        }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary {
          background: var(--accent);
          color: white;
        }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
      `}</style>
    </div>
  );
}
