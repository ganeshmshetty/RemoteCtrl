import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogOut, MousePointer, Hand, Send, BookOpen, Loader2, Radio, X, Play, StopCircle, ChevronRight, ChevronLeft, RotateCw } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useAgentStore } from '../stores/useAgentStore';
import type { ChatMessage } from '../stores/useAgentStore';
import { useControllerWebRTC } from '../hooks/useWebRTC';
import type { AgentStatusPayload, AgentLogPayload, WorkflowRunStatus, WorkflowStepStatus, LocalWorkflow, TabInfo } from '../../shared/types';

export function ControllerSession() {
  const navigate = useNavigate();
  const location = useLocation();
  const { controllerState, error, reset } = useConnectionStore();
  const {
    isTakeoverActive, agentStatus, chatHistory, setTakeoverActive,
    workflowRunState, workflowStepStatuses,
    clearWorkflow,
  } = useAgentStore();
  const [prompt, setPrompt] = useState('');
  const [workflows, setWorkflows] = useState<LocalWorkflow[]>([]);
  const [showWorkflowPicker, setShowWorkflowPicker] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<LocalWorkflow | null>(null);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeTab = tabs.find(t => t.active);
    if (activeTab && activeTab.url !== urlInput) {
      setUrlInput(activeTab.url);
    }
  }, [tabs]);

  const pin = (location.state as { pin?: string })?.pin ?? '';

  useEffect(() => {
    if (pin) {
      window.RemoteCtrlAPI?.controller.connect(pin);
    }
  }, [pin]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // Load workflow library for "Run on Host" picker
  useEffect(() => {
    window.RemoteCtrlAPI?.workflows.list().then(setWorkflows).catch(() => { });
  }, []);

  async function handleDisconnect() {
    await window.RemoteCtrlAPI?.controller.disconnect();
    reset();
    navigate('/');
  }

  function handleToggleTakeover() {
    setTakeoverActive(!isTakeoverActive);
  }

  function handleSwitchTab(tabId: string) {
    sendData({
      type: 'SWITCH_TAB',
      version: '1.0',
      timestamp: Date.now(),
      payload: { tabId },
    }, true);
  }

  function handleBrowserAction(action: 'goBack' | 'goForward' | 'reload' | 'navigate' | 'closeTab', tabId?: string) {
    sendData({
      type: 'BROWSER_ACTION',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action, url: urlInput, tabId },
    }, true);
  }

  function handleSendPrompt(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text) return;

    const commandId = crypto.randomUUID();

    // Append user message to chat immediately
    useAgentStore.getState().appendMessage({
      id: `user-${commandId}`,
      sender: 'user',
      type: 'prompt',
      text,
      timestamp: Date.now(),
    });

    // Send AGENT_PROMPT over reliable data channel to Host
    sendData({
      type: 'AGENT_PROMPT',
      version: '1.0',
      timestamp: Date.now(),
      id: commandId,
      payload: { commandId, action: 'act', instruction: text },
    }, true);

    setPrompt('');
  }

  function handleCancelAgent() {
    sendData({ type: 'AGENT_PROMPT', version: '1.0', timestamp: Date.now(), payload: { commandId: '__cancel__', action: 'act', instruction: '' } }, true);
    window.RemoteCtrlAPI?.browser.cancelAgent();
  }

  function handleRunWorkflow() {
    if (!selectedWorkflow) return;
    const workflowRunId = crypto.randomUUID();
    clearWorkflow();
    sendData({
      type: 'AGENT_WORKFLOW_BATCH',
      version: '1.0',
      timestamp: Date.now(),
      payload: {
        workflowRunId,
        workflowId: selectedWorkflow.id,
        name: selectedWorkflow.name,
        startUrl: selectedWorkflow.startUrl,
        steps: selectedWorkflow.steps,
      },
    }, true);
    setShowWorkflowPicker(false);
  }

  function handleCancelWorkflow() {
    sendData({ type: 'WORKFLOW_CANCEL', version: '1.0', timestamp: Date.now(), payload: {} }, true);
  }

  const isConnected = controllerState === 'SESSION_ACTIVE' || controllerState === 'CONTROLLING_REMOTELY';
  const isConnecting = ['SIGNALING_CONNECTING', 'WAITING_FOR_HOST_APPROVAL', 'WEBRTC_CONNECTING'].includes(controllerState);

  const { videoRef, status: rtcStatus, sendData, onMessage } = useControllerWebRTC(isConnected);

  // Phase 4+5: Handle incoming agent/workflow messages from Host via data channel
  onMessage((msg) => {
    const store = useAgentStore.getState();
    if (msg.type === 'AGENT_STATUS_UPDATE') {
      store.handleAgentStatus(msg.payload as AgentStatusPayload);
    } else if (msg.type === 'AGENT_LOG') {
      store.handleAgentLog(msg.payload as AgentLogPayload);
    } else if (msg.type === 'WORKFLOW_RUN_STATUS') {
      store.handleWorkflowRunStatus(msg.payload as WorkflowRunStatus);
    } else if (msg.type === 'WORKFLOW_STEP_STATUS') {
      store.handleWorkflowStepStatus(msg.payload as WorkflowStepStatus);
    } else if (msg.type === 'TAB_LIST') {
      setTabs(msg.payload as TabInfo[]);
    }
  });

  // Phase 3: Input Handling
  const lastMoveTimeRef = useRef<number>(0);

  // Compute coords relative to the actual rendered video content area.
  // With object-fit:contain the video element may be larger than the video
  // content (letterboxed / pillarboxed). We must subtract those offsets so
  // (0,0) → top-left of content and (1,1) → bottom-right of content.
  const getCoords = (clientX: number, clientY: number) => {
    const el = videoRef.current;
    if (!el) return { xPercent: 0, yPercent: 0 };

    const rect = el.getBoundingClientRect();
    // Intrinsic stream resolution (falls back to Playwright viewport size)
    const nativeW = el.videoWidth  || 1280;
    const nativeH = el.videoHeight || 800;

    // Scale factor applied by contain (uniform, preserves AR)
    const scale = Math.min(rect.width / nativeW, rect.height / nativeH);
    const renderedW = nativeW * scale;
    const renderedH = nativeH * scale;

    // Offset of the video content within the element box (letterbox/pillarbox)
    const offsetX = (rect.width  - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;

    // Position relative to the content region
    const relX = clientX - rect.left - offsetX;
    const relY = clientY - rect.top  - offsetY;

    return {
      xPercent: Math.max(0, Math.min(1, relX / renderedW)),
      yPercent: Math.max(0, Math.min(1, relY / renderedH)),
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
        {/* Video pane with Tab Strip */}
        <div className="ctrl-video-pane">
          {/* Tab Strip */}
          {isConnected && tabs.length > 0 && (
            <div className="ctrl-tab-strip">
              <div className="ctrl-nav-btns">
                <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('goBack')} title="Go back"><ChevronLeft size={14} /></button>
                <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('goForward')} title="Go forward"><ChevronRight size={14} /></button>
                <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('reload')} title="Reload"><RotateCw size={12} /></button>
              </div>
              <form 
                className="ctrl-address-bar"
                onSubmit={(e) => { e.preventDefault(); handleBrowserAction('navigate'); }}
              >
                <input 
                  type="text" 
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  className="ctrl-url-input"
                  placeholder="Enter URL..."
                />
              </form>
              <div className="ctrl-tabs">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`ctrl-tab ${tab.active ? 'ctrl-tab-active' : ''}`}
                    onClick={() => handleSwitchTab(tab.id)}
                    title={tab.url}
                  >
                    <span className="ctrl-tab-title">{tab.title}</span>
                    <button className="ctrl-tab-close" onClick={(e) => { e.stopPropagation(); handleBrowserAction('closeTab', tab.id); }}><X size={10} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="ctrl-video-container">

          {isConnecting ? (
            <div className="ctrl-connecting">
              <Loader2 size={32} className="animate-spin" />
              <div className="ctrl-connecting-text">Connecting…</div>
            </div>
          ) : isConnected ? (
            <>
              {/* Live video stream from host's Playwright browser.
                  object-fit:contain preserves the 1280×800 AR — black bars
                  fill the remaining space. */}
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
              {/* Takeover overlay — Phase 3: capture mouse/keyboard events.
                  Covers the full video element (incl. letterbox areas) so
                  events are always captured; getCoords() subtracts the
                  letterbox offsets so coordinates map to the content only. */}
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
                  ref={(el) => el?.focus()}
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
              disabled={!isConnected || agentStatus === 'running' || workflowRunState === 'running'}
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
              disabled={!isConnected || !prompt.trim() || agentStatus === 'running' || workflowRunState === 'running'}
            >
              <Send size={14} />
              Send
            </button>
            {agentStatus === 'running' && (
              <button
                type="button"
                className="btn btn-ghost ctrl-send-btn"
                onClick={handleCancelAgent}
                title="Request agent cancellation"
              >
                <X size={14} />
                Cancel
              </button>
            )}
          </form>

          {/* ── Workflow Panel ─────────────────────────────── */}
          <div className="ctrl-workflow-section">
            <div className="ctrl-workflow-header">
              <BookOpen size={13} />
              <span>Workflows</span>
              <button
                className="btn btn-ghost ctrl-wf-btn"
                onClick={() => { setShowWorkflowPicker(!showWorkflowPicker); }}
                disabled={!isConnected}
                title="Run a saved workflow on Host"
              >
                <Play size={12} /> Run on Host
              </button>
            </div>

            {/* Workflow Picker */}
            {showWorkflowPicker && (
              <div className="ctrl-wf-picker">
                {workflows.length === 0 ? (
                  <div className="ctrl-wf-picker-empty">
                    No workflows saved yet.{' '}
                    <button className="ctrl-wf-link" onClick={() => navigate('/workflows/new')}>Create one</button>
                  </div>
                ) : (
                  <>
                    <div className="ctrl-wf-list">
                      {workflows.map((wf) => (
                        <button
                          key={wf.id}
                          className={`ctrl-wf-item${selectedWorkflow?.id === wf.id ? ' ctrl-wf-item--selected' : ''}`}
                          onClick={() => setSelectedWorkflow(wf)}
                        >
                          <ChevronRight size={11} />
                          <span className="ctrl-wf-item-name">{wf.name}</span>
                          <span className="ctrl-wf-item-steps">{wf.steps.length}s</span>
                        </button>
                      ))}
                    </div>
                    <div className="ctrl-wf-actions">
                      <button
                        className="btn btn-primary"
                        onClick={handleRunWorkflow}
                        disabled={!selectedWorkflow || workflowRunState === 'running'}
                      >
                        <Play size={12} /> Run
                      </button>
                      <button className="btn btn-ghost" onClick={() => setShowWorkflowPicker(false)}>Close</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Active workflow run status */}
            {workflowRunState !== 'idle' && (
              <div className="ctrl-wf-run">
                <div className="ctrl-wf-run-header">
                  {workflowRunState === 'running' && <Loader2 size={12} className="animate-spin" />}
                  <span className={`badge badge-${workflowRunState === 'running' ? 'accent' : workflowRunState === 'completed' ? 'success' : 'danger'}`}>
                    Workflow {workflowRunState}
                  </span>
                  {workflowRunState === 'running' && (
                    <button className="btn btn-ghost ctrl-wf-cancel" onClick={handleCancelWorkflow} title="Cancel workflow">
                      <StopCircle size={12} /> Cancel
                    </button>
                  )}
                </div>
                {workflowStepStatuses.length > 0 && (
                  <div className="ctrl-wf-steps">
                    {workflowStepStatuses.map((s) => (
                      <div key={`${s.workflowRunId}-${s.stepId}`} className={`ctrl-wf-step ctrl-wf-step--${s.state}`}>
                        <span className="ctrl-wf-step-idx">{s.index + 1}</span>
                        <span className="ctrl-wf-step-state">{s.state}</span>
                        {s.error && <span className="ctrl-wf-step-err" title={s.error}>✕</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
          display: flex;
          flex-direction: column;
          background: #05050a;
          overflow: hidden;
        }
        .ctrl-video-container {
          flex: 1;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .ctrl-video {
          width: 100%;
          height: 100%;
          /* contain: preserve the Playwright viewport aspect ratio.
             Black bars fill the remainder — no distortion. */
          object-fit: contain;
          display: block;
          background: #000;
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
        .ctrl-tab-strip {
          height: 36px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          padding: 0 12px;
          gap: 12px;
          flex-shrink: 0;
          z-index: 10;
        }
        .ctrl-nav-btns {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .ctrl-nav-btn {
          background: transparent;
          border: none;
          color: var(--text-secondary);
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background var(--transition);
        }
        .ctrl-nav-btn:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .ctrl-address-bar {
          flex: 1;
          max-width: 400px;
          display: flex;
        }
        .ctrl-url-input {
          width: 100%;
          height: 24px;
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          color: var(--text-primary);
          padding: 0 10px;
          font-size: 11px;
          outline: none;
          transition: border-color var(--transition);
        }
        .ctrl-url-input:focus {
          border-color: var(--accent);
        }
        .ctrl-tabs {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          flex: 1;
        }
        .ctrl-tab {
          display: flex;
          align-items: center;
          height: 26px;
          padding: 0 12px;
          border-radius: var(--radius-sm);
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-secondary);
          font-size: 12px;
          cursor: pointer;
          white-space: nowrap;
          max-width: 200px;
          min-width: 80px;
          overflow: hidden;
          transition: all var(--transition);
          gap: 6px;
        }
        .ctrl-tab:hover {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .ctrl-tab-active {
          background: var(--bg-elevated);
          color: var(--text-primary);
          border-color: var(--border);
        }
        .ctrl-tab-title {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .ctrl-tab-close {
          background: transparent;
          border: none;
          color: var(--text-muted);
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          cursor: pointer;
          padding: 0;
        }
        .ctrl-tab-close:hover {
          background: rgba(255,255,255,0.1);
          color: var(--text-primary);
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
          cursor: default;
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

        /* ── Workflow panel ── */
        .ctrl-workflow-section {
          border-top: 1px solid var(--border);
          padding: 10px 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ctrl-workflow-header {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .ctrl-workflow-header span { flex: 1; }
        .ctrl-wf-btn { height: 26px; padding: 0 8px; font-size: 11px; }
        .ctrl-wf-picker {
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          overflow: hidden;
        }
        .ctrl-wf-picker-empty {
          padding: 12px;
          font-size: 12px;
          color: var(--text-muted);
          text-align: center;
        }
        .ctrl-wf-link {
          background: none; border: none; color: var(--accent);
          cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline;
        }
        .ctrl-wf-list {
          max-height: 140px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .ctrl-wf-item {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 12px; border: none; background: transparent;
          color: var(--text-secondary); cursor: pointer;
          font-size: 12px; text-align: left;
          transition: background var(--transition), color var(--transition);
          border-bottom: 1px solid var(--border);
        }
        .ctrl-wf-item:last-child { border-bottom: none; }
        .ctrl-wf-item:hover { background: var(--bg-elevated); color: var(--text-primary); }
        .ctrl-wf-item--selected { background: var(--accent-glow); color: var(--accent); }
        .ctrl-wf-item-name { flex: 1; }
        .ctrl-wf-item-steps { font-size: 10px; color: var(--text-muted); }
        .ctrl-wf-actions {
          display: flex; gap: 6px; padding: 8px 12px;
          border-top: 1px solid var(--border); background: var(--bg-surface);
        }
        .ctrl-wf-run {
          background: var(--bg-overlay);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          display: flex; flex-direction: column; gap: 6px;
        }
        .ctrl-wf-run-header {
          display: flex; align-items: center; gap: 6px;
        }
        .ctrl-wf-cancel { height: 22px; padding: 0 6px; font-size: 10px; margin-left: auto; }
        .ctrl-wf-steps {
          display: flex; flex-wrap: wrap; gap: 4px;
        }
        .ctrl-wf-step {
          display: flex; align-items: center; gap: 3px;
          padding: 2px 7px; border-radius: 99px;
          font-size: 10px; font-weight: 600;
        }
        .ctrl-wf-step--running  { background: var(--accent-glow); color: var(--accent); }
        .ctrl-wf-step--completed { background: rgba(34,197,94,0.15); color: var(--success); }
        .ctrl-wf-step--failed   { background: rgba(239,68,68,0.15); color: var(--danger); }
        .ctrl-wf-step--skipped  { background: var(--bg-elevated); color: var(--text-muted); }
        .ctrl-wf-step-idx { font-weight: 700; }
        .ctrl-wf-step-err { cursor: help; }
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

