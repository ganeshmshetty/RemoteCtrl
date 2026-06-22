import { useState } from 'react';
import { Monitor } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';

export function ConnectionPlaceholder() {
  const [pinInput, setPinInput] = useState('');
  const { setRole } = useConnectionStore();

  function handleHost() {
    setRole('host');
    window.RemoteCtrlAPI?.host.start();
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = pinInput.replace(/\D/g, '');
    if (cleaned.length === 9) {
      setRole('controller');
      window.RemoteCtrlAPI?.controller.connect(cleaned);
    }
  }

  return (
    <div className="connection-placeholder">
      <div className="cp-icon">
        <Monitor size={48} strokeWidth={1} />
      </div>
      
      <h2 className="cp-title">No browser connected</h2>
      <p className="cp-subtitle">Start hosting or join a session to begin.</p>
      
      <button 
        className="btn btn-primary cp-host-btn"
        onClick={handleHost}
      >
        Host your browser
      </button>

      <div className="cp-divider">
        <div className="cp-divider-line"></div>
        <span className="cp-divider-text">or</span>
        <div className="cp-divider-line"></div>
      </div>

      <form onSubmit={handleJoin} className="cp-pin-form">
        <input
          type="text"
          className="cp-pin-input"
          placeholder="PIN (9 digits)"
          value={pinInput}
          maxLength={9}
          onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
        />
        <button 
          type="submit" 
          className="btn btn-ghost cp-join-btn"
          disabled={pinInput.length !== 9}
        >
          Join →
        </button>
      </form>
    </div>
  );
}
