import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, MousePointer, Hand, Send, BookOpen, Loader2, Radio } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useAgentStore } from '../stores/useAgentStore';
import type { ChatMessage } from '../stores/useAgentStore';
import { useControllerWebRTC } from '../hooks/useWebRTC';

export function ControllerSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { controllerState, error, reset } = useConnectionStore();
  const { isTakeoverActive, agentStatus, chatHistory, setTakeoverActive } = useAgentStore();
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const pin = (location.state as { pin?: string })?.pin ?? '';

  useEffect(() => {
    if (pin) {
      window.remconAPI?.controller.connect(pin);
    }
  }, [pin]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  async function handleDisconnect() {
    await window.remconAPI?.controller.disconnect();
    reset();
    navigate('/');
  }

  function handleToggleTakeover() {
    setTakeoverActive(!isTakeoverActive);
  }

  function handleSendPrompt(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    // Phase 4: send over WebRTC data channel
    // For now just log to chat
    useAgentStore.getState().appendMessage({
      id: `user-${Date.now()}`,
      sender: 'user',
      type: 'prompt',
      text: prompt.trim(),
      timestamp: Date.now(),
    });
    setPrompt('');
  }

  const isConnected = controllerState === 'SESSION_ACTIVE' || controllerState === 'CONTROLLING_REMOTELY';
  const isConnecting = ['SIGNALING_CONNECTING', 'WAITING_FOR_HOST_APPROVAL', 'WEBRTC_CONNECTING'].includes(controllerState);

  const { videoRef, status: rtcStatus, sendData } = useControllerWebRTC(isConnected);

  // Phase 3: Input Handling
  const lastMoveTimeRef = useRef<number>(0);

  // Always compute coords from the video element itself — it's the authoritative
  // display surface. With object-fit:fill it matches the overlay 1:1.
  const getCoords = (clientX: number, clientY: number) => {
    const rect = videoRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1, height: 1 };
    return {
      xPercent: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      yPercent: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    const now = Date.now();
    if (now - lastMoveTimeRef.current < 16) return; // throttle ~60fps
    lastMoveTimeRef.current = now;

    const { xPercent, yPercent } = getCoords(e.clientX, e.clientY);

    sendData({
      type: 'REMOTE_INPUT_MOUSE',
      version: '1.0',
      timestamp: now,
      payload: { action: 'move', xPercent, yPercent }
    }, false);
  };

  const handleMouseEvent = (e: React.MouseEvent<HTMLDivElement>, action: 'click' | 'down' | 'up') => {
    if (!isTakeoverActive) return;
    const { xPercent, yPercent } = getCoords(e.clientX, e.clientY);
    
    let button: 'left' | 'middle' | 'right' = 'left';
    if (e.button === 1) button = 'middle';
    if (e.button === 2) button = 'right';

    sendData({
      type: 'REMOTE_INPUT_MOUSE',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action, xPercent, yPercent, button }
    }, true);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    const { xPercent, yPercent } = getCoords(e.clientX, e.clientY);
    
    sendData({
      type: 'REMOTE_INPUT_MOUSE',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action: 'scroll', xPercent, yPercent, deltaY: e.deltaY }
    }, false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    e.preventDefault();
    sendData({
      type: 'REMOTE_INPUT_KEYBOARD',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action: 'down', key: e.key }
    }, true);
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    e.preventDefault();
    sendData({
      type: 'REMOTE_INPUT_KEYBOARD',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action: 'up', key: e.key }
    }, true);
  };

  return (
    <div className="ctrl-root">
      {/* Top bar */}
      <div className="ctrl-topbar drag-region">
        <div className="ctrl-topbar-left no-drag">
          <div className={`ctrl-dot ${isConnected ? 'ctrl-dot-on' : 'ctrl-dot-off'}`} />
          <span className="ctrl-status-text">
            {isConnecting ? 'Connecting…' : isConnected ? 'Connected' : controllerState === 'DISCONNECTED' ? 'Disconnected' : `PIN ${pin}`}
          </span>
          {isConnected && rtcStatus === 'streaming' && (
            <span className="ctrl-live-badge"><Radio size={10} /> Live</span>
          )}
        </div>
        <div className="ctrl-topbar-right no-drag">
          {/* Takeover toggle */}
          <button
            className={`btn ${isTakeoverActive ? 'btn-takeover-active' : 'btn-takeover'}`}
            onClick={handleToggleTakeover}
            title="Toggle manual control"
          >
            {isTakeoverActive ? <Hand size={14} /> : <MousePointer size={14} />}
            {isTakeoverActive ? 'Release' : 'Takeover'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/workflows')}
            title="Workflow library"
          >
            <BookOpen size={14} /> Workflows
          </button>
          <button className="btn btn-ghost" onClick={handleDisconnect}>
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="ctrl-body">
        {/* Video pane */}
        <div className="ctrl-video-pane">
          {isConnecting ? (
            <div className="ctrl-connecting">
              <Loader2 size={32} className="animate-spin" />
              <div className="ctrl-connecting-text">Connecting…</div>
            </div>
          ) : isConnected ? (
            <>
              {/* Live video stream from host's Playwright browser */}
              <video
                ref={videoRef}
                className="ctrl-video"
                autoPlay
                muted
                playsInline
              />
              {/* Waiting for stream overlay */}
              {rtcStatus !== 'streaming' && (
                <div className="ctrl-video-overlay">
                  <Loader2 size={24} className="animate-spin" />
                  <div className="ctrl-connecting-text">
                    {rtcStatus === 'connecting' ? 'Waiting for stream…' : 'Preparing…'}
                  </div>
                </div>
              )}
              {/* Takeover overlay — Phase 3: capture mouse/keyboard events */}
              {isTakeoverActive && (
                <div 
                  className="ctrl-takeover-overlay"
                  tabIndex={0}
                  onMouseMove={handleMouseMove}
                  onMouseDown={(e) => handleMouseEvent(e, 'down')}
                  onMouseUp={(e) => handleMouseEvent(e, 'up')}
                  onWheel={handleWheel}
                  onKeyDown={handleKeyDown}
                  onKeyUp={handleKeyUp}
                  onContextMenu={(e) => e.preventDefault()}
                  ref={(el) => el?.focus()} // auto focus to capture keyboard
                />
              )}
            </>
          ) : (
            <div className="ctrl-connecting">
              <div className="ctrl-connecting-text ctrl-connecting-text--dim">
                {error ?? 'Not connected'}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="ctrl-sidebar">
          {/* Chat history */}
          <div className="ctrl-chat">
            {chatHistory.length === 0 ? (
              <div className="ctrl-chat-empty">
                Send a prompt to control the remote browser
              </div>
            ) : (
              chatHistory.map((msg) => <ChatBubble key={msg.id} msg={msg} />)
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Agent status badge */}
          {agentStatus !== 'idle' && (
            <div className="ctrl-agent-status">
              {agentStatus === 'running' && <Loader2 size={12} className="animate-spin" />}
              <span className={`badge badge-${agentStatus === 'running' ? 'accent' : agentStatus === 'error' ? 'danger' : 'success'}`}>
                Agent {agentStatus}
              </span>
            </div>
          )}

          {/* Prompt input */}
          <form className="ctrl-prompt-form" onSubmit={handleSendPrompt}>
            <textarea
              className="ctrl-prompt-input"
              placeholder={isConnected ? 'Describe what to do…' : 'Waiting for connection…'}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={!isConnected || agentStatus === 'running'}
              rows={3}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  handleSendPrompt(e as any);
                }
              }}
            />
            <button
              type="submit"
              className="btn btn-primary ctrl-send-btn"
              disabled={!isConnected || !prompt.trim() || agentStatus === 'running'}
            >
              <Send size={14} />
              Send
            </button>
          </form>
        </div>
      </div>

      <style>{`
        .ctrl-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
        }
        .ctrl-topbar {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-surface);
          flex-shrink: 0;
        }
        .ctrl-topbar-left, .ctrl-topbar-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ctrl-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
        }
        .ctrl-dot-on  { background: var(--success); }
        .ctrl-dot-off { background: var(--text-muted); }
        .ctrl-status-text { font-size: 12px; color: var(--text-secondary); }
        .ctrl-live-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 99px;
          font-size: 11px; font-weight: 700;
          background: rgba(34,197,94,0.15); color: var(--success);
          border: 1px solid rgba(34,197,94,0.3);
        }
        .ctrl-body {
          flex: 1;
          display: flex;
          overflow: hidden;
        }
        .ctrl-video-pane {
          flex: 1;
          position: relative;
          background: #05050a;
          overflow: hidden;
        }
        .ctrl-video {
          width: 100%;
          height: 100%;
          object-fit: fill;
          display: block;
        }
        .ctrl-video-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          background: rgba(5,5,10,0.7);
          color: var(--text-secondary);
          backdrop-filter: blur(4px);
        }
        .ctrl-connecting {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--text-secondary);
        }
        .ctrl-connecting-text { font-size: 13px; }
        .ctrl-connecting-text--dim { color: var(--text-muted); }
        .ctrl-takeover-overlay {
          position: absolute;
          inset: 0;
          cursor: none;
          border: 2px solid var(--danger);
        }
        .ctrl-sidebar {
          width: 300px;
          flex-shrink: 0;
          border-left: 1px solid var(--border);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
        }
        .ctrl-chat {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ctrl-chat-empty {
          margin: auto;
          text-align: center;
          font-size: 12px;
          color: var(--text-muted);
          padding: 24px;
          line-height: 1.6;
        }
        .ctrl-agent-status {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-top: 1px solid var(--border);
        }
        .ctrl-prompt-form {
          padding: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ctrl-prompt-input {
          width: 100%;
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-size: 13px;
          padding: 8px 12px;
          resize: none;
          outline: none;
          transition: border-color var(--transition);
          line-height: 1.5;
        }
        .ctrl-prompt-input:focus { border-color: var(--accent); }
        .ctrl-prompt-input:disabled { opacity: 0.5; }
        .ctrl-send-btn { align-self: flex-end; }
        .btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 6px; height: 32px; padding: 0 12px; border-radius: var(--radius-sm);
          font-size: 12px; font-weight: 600; cursor: pointer; border: none;
          transition: background var(--transition), opacity var(--transition), transform var(--transition);
          white-space: nowrap;
        }
        .btn:active { transform: scale(0.97); }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary  { background: var(--accent); color: white; }
        .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
        .btn-ghost    { background: transparent; color: var(--text-secondary); }
        .btn-ghost:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .btn-takeover { background: var(--bg-overlay); color: var(--text-secondary); border: 1px solid var(--border); }
        .btn-takeover:hover { border-color: var(--danger); color: var(--danger); }
        .btn-takeover-active { background: rgba(239,68,68,0.15); color: var(--danger); border: 1px solid rgba(239,68,68,0.5); }
        .badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600;
          letter-spacing: 0.03em; text-transform: uppercase;
        }
        .badge-accent  { background: var(--accent-glow); color: var(--accent); }
        .badge-danger  { background: rgba(239,68,68,0.15); color: var(--danger); }
        .badge-success { background: rgba(34,197,94,0.15); color: var(--success); }
      `}</style>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.sender === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '80%',
        padding: '8px 12px',
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        background: isUser ? 'var(--accent-glow)' : 'var(--bg-overlay)',
        border: `1px solid ${isUser ? 'rgba(124,106,247,0.3)' : 'var(--border)'}`,
        fontSize: '12px',
        lineHeight: '1.5',
        color: msg.type === 'log' ? 'var(--text-muted)' : 'var(--text-primary)',
        fontFamily: msg.type === 'log' ? 'var(--font-mono)' : 'inherit',
        wordBreak: 'break-word',
      }}>
        {msg.text}
      </div>
    </div>
  );
}

