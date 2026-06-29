import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, X, Plus, Loader2, Copy, Check } from 'lucide-react';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useControllerWebRTC, useHostWebRTC } from '../hooks/useWebRTC';
import { ConnectionPlaceholder } from './ConnectionPlaceholder';
import type { TabInfo, AgentStatusPayload, AgentLogPayload, WorkflowRunStatus, WorkflowStepStatus, AgentCheckpointPayload } from '../../shared/types';

export function BrowserPanel() {
  const { controllerState, hostState, error, pin } = useConnectionStore();
  const { isTakeoverActive } = useAgentStore();
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const [hasCopiedPin, setCopiedPin] = useState(false);
  
  const isConnected = 
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  const isConnecting = 
    ['SIGNALING_CONNECTING', 'WAITING_FOR_HOST_APPROVAL', 'WEBRTC_CONNECTING'].includes(controllerState);

  const isHostWaiting = ['REGISTERING_PIN', 'SIGNALING_CONNECTING', 'WAITING_FOR_CONTROLLER', 'AWAITING_HOST_APPROVAL'].includes(hostState);

  const isHost = hostState !== 'IDLE' && hostState !== 'REGISTERING_PIN' && hostState !== 'WAITING_FOR_CONTROLLER' && hostState !== 'AWAITING_HOST_APPROVAL';
  const isController = controllerState !== 'IDLE';

  const hostRTC = useHostWebRTC(isConnected && isHost);
  const ctrlRTC = useControllerWebRTC(isConnected && isController);

  const videoRef = isHost ? hostRTC.videoRef : ctrlRTC.videoRef;
  const hostSendData = useCallback((msg: any) => {
    if (msg.type === 'BROWSER_ACTION') {
      const { action, url, tabId } = msg.payload;
      if (action === 'navigate') window.RemoteCtrlAPI?.browser.navigate(url);
      else if (action === 'goBack') window.RemoteCtrlAPI?.browser.goBack();
      else if (action === 'goForward') window.RemoteCtrlAPI?.browser.goForward();
      else if (action === 'reload') window.RemoteCtrlAPI?.browser.reload();
      else if (action === 'closeTab') window.RemoteCtrlAPI?.browser.closeTab(tabId);
      else if (action === 'newTab') window.RemoteCtrlAPI?.browser.newTab();
    } else if (msg.type === 'SWITCH_TAB') {
      window.RemoteCtrlAPI?.browser.switchTab(msg.payload.tabId);
    } else if (msg.type === 'REMOTE_INPUT_MOUSE') {
      window.RemoteCtrlAPI?.browser.injectMouse(msg.payload);
    } else if (msg.type === 'REMOTE_INPUT_KEYBOARD') {
      window.RemoteCtrlAPI?.browser.injectKeyboard(msg.payload);
    } else if (msg.type === 'AGENT_PROMPT') {
      if (msg.payload.commandId === '__cancel__') {
        window.RemoteCtrlAPI?.browser.cancelAgent();
      } else {
        window.RemoteCtrlAPI?.browser.startAgent(msg.payload);
      }
    } else if (msg.type === 'AGENT_WORKFLOW_BATCH') {
      window.RemoteCtrlAPI?.browser.startWorkflow(msg.payload);
    }
  }, []);
  const sendData = isHost ? hostSendData : ctrlRTC.sendData;
  const noop = useCallback(() => {}, []);
  const onMessage = isHost ? noop : ctrlRTC.onMessage;
  const rtcStatus = isHost ? hostRTC.status : ctrlRTC.status;

  const lastMoveTimeRef = useRef<number>(0);

  useEffect(() => {
    useConnectionStore.getState().setSendData(sendData);
  }, [sendData]);

  useEffect(() => {
    const activeTab = tabs.find(t => t.active);
    if (activeTab && activeTab.url !== urlInput) {
      setUrlInput(activeTab.url);
    }
  }, [tabs]);

  useEffect(() => {
    if (isHost) {
      const cleanup = window.RemoteCtrlAPI?.on.tabsChange((newTabs) => {
        setTabs(newTabs);
      });
      return () => cleanup?.();
    }
  }, [isHost]);

  useEffect(() => {
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
      } else if (msg.type === 'AGENT_CHECKPOINT') {
        store.handleAgentCheckpoint(msg.payload as AgentCheckpointPayload);
      } else if (msg.type === 'TAB_LIST') {
        setTabs(msg.payload as TabInfo[]);
      }
    });
  }, [onMessage]);

  function handleBrowserAction(action: 'goBack' | 'goForward' | 'reload' | 'navigate' | 'closeTab' | 'newTab', tabId?: string) {
    sendData({
      type: 'BROWSER_ACTION',
      version: '1.0',
      timestamp: Date.now(),
      payload: { action, url: urlInput, tabId },
    }, true);
  }

  function handleSwitchTab(tabId: string) {
    sendData({
      type: 'SWITCH_TAB',
      version: '1.0',
      timestamp: Date.now(),
      payload: { tabId },
    }, true);
  }

  const getCoords = (clientX: number, clientY: number) => {
    const el = videoRef.current;
    if (!el) return { xPercent: 0, yPercent: 0 };
    const rect = el.getBoundingClientRect();
    const nativeW = el.videoWidth || 1280;
    const nativeH = el.videoHeight || 800;
    const scale = Math.min(rect.width / nativeW, rect.height / nativeH);
    const renderedW = nativeW * scale;
    const renderedH = nativeH * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    const relX = clientX - rect.left - offsetX;
    const relY = clientY - rect.top - offsetY;
    return {
      xPercent: Math.max(0, Math.min(1, relX / renderedW)),
      yPercent: Math.max(0, Math.min(1, relY / renderedH)),
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTakeoverActive) return;
    const now = Date.now();
    if (now - lastMoveTimeRef.current < 16) return;
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

  if (!isConnected && !isConnecting && !isHostWaiting) {
    return (
      <div className="browser-panel">
        <ConnectionPlaceholder />
      </div>
    );
  }

  function handleApprove() {
    if (useConnectionStore.getState().pendingControllerId) {
      window.RemoteCtrlAPI?.host.approveController(useConnectionStore.getState().pendingControllerId!);
    }
  }

  function handleReject() {
    if (useConnectionStore.getState().pendingControllerId) {
      window.RemoteCtrlAPI?.host.rejectController(useConnectionStore.getState().pendingControllerId!);
    }
  }

  function handleStopHosting() {
    window.RemoteCtrlAPI?.host.stop();
    useConnectionStore.getState().reset();
  }

  function handleCopyPin() {
    if (pin) {
      navigator.clipboard.writeText(pin);
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2000);
    }
  }

  return (
    <div className="browser-panel">
      {/* Browser Nav / Tabs */}
      {isConnected && tabs.length > 0 && (
        <div className="ctrl-tab-strip">
          <div className="ctrl-nav-btns">
            <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('goBack')}><ChevronLeft size={14} /></button>
            <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('goForward')}><ChevronRight size={14} /></button>
            <button className="ctrl-nav-btn" onClick={() => handleBrowserAction('reload')}><RotateCw size={12} /></button>
          </div>
          <form className="ctrl-address-bar" onSubmit={(e) => { e.preventDefault(); handleBrowserAction('navigate'); }}>
            <input type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)} className="ctrl-url-input" />
          </form>
          <div className="ctrl-tabs">
            {tabs.map((tab) => (
              <div key={tab.id} className={`ctrl-tab ${tab.active ? 'ctrl-tab-active' : ''}`} onClick={() => handleSwitchTab(tab.id)}>
                <span className="ctrl-tab-title truncate">{tab.title}</span>
                <button className="ctrl-tab-close" onClick={(e) => { e.stopPropagation(); handleBrowserAction('closeTab', tab.id); }}><X size={10} /></button>
              </div>
            ))}
            <button className="ctrl-tab-new" onClick={() => handleBrowserAction('newTab')}><Plus size={14} /></button>
          </div>
        </div>
      )}

      {/* Video Stream Container */}
      <div className="browser-video-container">
        {isHostWaiting ? (
          <div className="browser-loading" style={{ gap: 20 }}>
            {['REGISTERING_PIN', 'SIGNALING_CONNECTING', 'WAITING_FOR_CONTROLLER'].includes(hostState) && (
              <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 600 }}>Waiting for Controller</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '8px' }}>Share this PIN to allow remote control:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '24px 0' }}>
                  <div style={{ 
                    fontSize: '48px', 
                    fontFamily: 'var(--font-mono)', 
                    fontWeight: 700, 
                    letterSpacing: '0.1em',
                    color: 'var(--accent)',
                    minHeight: '60px',
                    display: 'flex',
                    alignItems: 'center',
                  }}>
                    {pin ? (
                      <span className="animate-pop-in">{pin}</span>
                    ) : (
                      <span className="animate-pulse" style={{ filter: 'blur(5px)', opacity: 0.4, userSelect: 'none' }}>000000000</span>
                    )}
                  </div>
                  <button 
                    className="icon-btn" 
                    onClick={handleCopyPin}
                    style={{ 
                      width: '40px', 
                      height: '40px', 
                      border: '1px solid var(--border)',
                      opacity: pin ? 1 : 0.5,
                      pointerEvents: pin ? 'auto' : 'none'
                    }}
                    title="Copy PIN"
                  >
                    {hasCopiedPin ? <Check size={20} color="var(--success)" /> : <Copy size={20} />}
                  </button>
                </div>
                <button className="btn btn-ghost" onClick={handleStopHosting} style={{ color: 'var(--danger)' }}>
                  Stop Hosting
                </button>
              </div>
            )}
            {hostState === 'AWAITING_HOST_APPROVAL' && (
              <div className="session-approval animate-fade-in" style={{
                background: 'var(--bg-overlay)', padding: 24, borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16
              }}>
                <div style={{ fontSize: '16px', fontWeight: 600 }}>Controller wants to connect</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {useConnectionStore.getState().pendingControllerId}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                  <button className="btn btn-danger" onClick={handleReject}>Reject</button>
                  <button className="btn btn-primary" onClick={handleApprove}>Approve</button>
                </div>
              </div>
            )}
          </div>
        ) : isConnecting ? (
          <div className="browser-loading">
            <Loader2 size={32} className="animate-spin" style={{ marginBottom: 8 }} />
            <div>Connecting...</div>
          </div>
        ) : isConnected ? (
          <>
            <video ref={videoRef} className="browser-video" autoPlay muted playsInline />
            {rtcStatus !== 'streaming' && (
              <div className="browser-loading">
                <Loader2 size={24} className="animate-spin" style={{ marginBottom: 8 }} />
                <div>Waiting for stream...</div>
              </div>
            )}
            {isTakeoverActive && (
              <div
                className="takeover-overlay"
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
          <div className="browser-loading">
            {error ?? 'Disconnected'}
          </div>
        )}
      </div>
    </div>
  );
}
