import { useEffect, useRef, useState } from 'react';
import { Send, Bot, Zap, StopCircle, Hand, MousePointer, Save, Loader2 } from 'lucide-react';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';
import { useUIStore } from '../stores/useUIStore';
import type { ChatMessage } from '../stores/useAgentStore';
import type { AgentCheckpointPayload } from '../../shared/types';

export function AgentPanel() {
  const { 
    chatHistory, isTakeoverActive, setTakeoverActive, 
    workflowRunState, workflowRunId, workflowStepStatuses,
    agentStatus, currentAction
  } = useAgentStore();
  
  const { controllerState, hostState, sendData } = useConnectionStore();
  const [prompt, setPrompt] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const isConnected = 
    hostState === 'SESSION_ACTIVE' || 
    hostState === 'AGENT_EXECUTING' || 
    hostState === 'HUMAN_TAKEOVER' ||
    controllerState === 'SESSION_ACTIVE' ||
    controllerState === 'CONTROLLING_REMOTELY';

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, workflowRunState]);

  function handleSendPrompt(e: React.FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || !isConnected) return;

    const commandId = crypto.randomUUID();
    useAgentStore.getState().appendMessage({
      id: `user-${commandId}`,
      sender: 'user',
      type: 'prompt',
      text,
      timestamp: Date.now(),
    });

    const payload = { commandId, action: 'act' as const, instruction: text };

    if (controllerState !== 'IDLE' && sendData) {
      sendData({
        type: 'AGENT_PROMPT',
        version: '1.0',
        timestamp: Date.now(),
        id: commandId,
        payload,
      }, true);
    } else if (hostState !== 'IDLE') {
      window.RemoteCtrlAPI?.browser.startAgent(payload);
    }

    setPrompt('');
  }

  function handleCancelAgent() {
    if (controllerState !== 'IDLE' && sendData) {
      sendData({ type: 'AGENT_PROMPT', version: '1.0', timestamp: Date.now(), payload: { commandId: '__cancel__', action: 'act', instruction: '' } }, true);
    } else if (hostState !== 'IDLE') {
      window.RemoteCtrlAPI?.browser.cancelAgent();
    }
  }

  function handleCheckpointResponse(checkpointId: string, selectedOptionId: string) {
    if (controllerState !== 'IDLE' && sendData) {
      sendData({
        type: 'AGENT_CHECKPOINT_RESPONSE',
        version: '1.0',
        timestamp: Date.now(),
        payload: { checkpointId, response: { selectedOptionId } },
      }, true);
    } else if (hostState !== 'IDLE') {
      window.RemoteCtrlAPI?.browser.submitCheckpoint(checkpointId, { selectedOptionId });
    }
  }

  function handleTakeover() {
    setTakeoverActive(true);
  }

  return (
    <div className="agent-panel">
      <div className="agent-chat-area">
        {workflowRunState !== 'idle' && workflowRunId && (
          <div className="agent-workflow-status">
            <div className="agent-workflow-status-title">
              <Zap size={14} style={{ marginRight: 6 }} /> Workflow Status: {workflowRunState}
            </div>
            <div>
              {workflowStepStatuses.map((step, i) => (
                <div key={i} className="agent-workflow-step">
                  <span className={`agent-workflow-step-dot ${step.state}`}></span>
                  <span style={{ color: step.state === 'skipped' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    Step {step.index + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {chatHistory.length === 0 && workflowRunState === 'idle' && (
          <div className="agent-chat-empty">
            <Bot size={32} strokeWidth={1} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div>Agent is ready.</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Ask it to do something!</div>
          </div>
        )}

        {chatHistory.map((msg) => (
          <ChatBubble
            key={msg.id}
            msg={msg}
            onCheckpointResponse={handleCheckpointResponse}
            onTakeover={handleTakeover}
          />
        ))}
        
        {agentStatus === 'running' && (
          <div className="agent-executing-status">
            <Loader2 className="animate-spin" size={14} />
            <span>{currentAction || 'Executing task...'}</span>
          </div>
        )}
        
        {chatHistory.length > 0 && chatHistory[chatHistory.length - 1].type === 'status' && (
          <button className="btn btn-ghost agent-save-workflow-btn" onClick={() => useUIStore.getState().openWorkflowEditor()}>
            <Save size={14} style={{ marginRight: 4 }} /> Save as Workflow
          </button>
        )}
        
        <div ref={chatEndRef} />
      </div>

      <div className="agent-input-area">
        <div className="agent-controls">
          <button 
            className={`agent-control-btn ${isTakeoverActive ? 'active' : ''}`}
            onClick={() => setTakeoverActive(!isTakeoverActive)}
            disabled={!isConnected}
          >
            {isTakeoverActive ? <Hand size={14} /> : <MousePointer size={14} />}
            {isTakeoverActive ? 'Release' : 'Takeover'}
          </button>
        </div>

        <form onSubmit={handleSendPrompt} className="agent-prompt-form">
          <textarea
            className="agent-prompt-input"
            placeholder={isConnected ? "What should I do?" : "Connect to a browser first..."}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!isConnected}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendPrompt(e as any);
              }
            }}
          />
          {agentStatus === 'running' ? (
            <button
              type="button"
              className="agent-prompt-send danger"
              onClick={handleCancelAgent}
              title="Stop execution"
            >
              <StopCircle size={18} />
            </button>
          ) : (
            <button
              type="submit"
              className="agent-prompt-send"
              disabled={!prompt.trim() || !isConnected}
              title="Send prompt"
            >
              <Send size={18} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function ChatBubble({
  msg,
  onCheckpointResponse,
  onTakeover,
}: {
  msg: ChatMessage;
  onCheckpointResponse?: (checkpointId: string, optionId: string) => void;
  onTakeover?: () => void;
}) {
  const isUser = msg.sender === 'user';

  // Checkpoint — interactive option buttons
  if (msg.type === 'checkpoint' && msg.checkpointPayload) {
    const cp = msg.checkpointPayload as AgentCheckpointPayload;
    return (
      <div className="agent-msg">
        <div className="agent-msg-checkpoint">
          <div className="agent-msg-checkpoint-title">Agent Needs Input</div>
          <div className="agent-msg-checkpoint-question">{msg.text}</div>
          <div className="agent-msg-checkpoint-options">
            {cp.options.map((opt) => (
              <button
                key={opt.id}
                className={`agent-checkpoint-option ${opt.recommended ? 'recommended' : ''}`}
                onClick={() => onCheckpointResponse?.(cp.checkpointId, opt.id)}
              >
                <div className="agent-checkpoint-option-label">{opt.label}</div>
                {opt.description && (
                  <div className="agent-checkpoint-option-desc">{opt.description}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error message with Takeover button
  if (msg.type === 'error') {
    return (
      <div className="agent-msg">
        <div className="agent-msg-error-card">
          <div className="agent-msg-error-title">Task Failed</div>
          <div className="agent-msg-error-text">{msg.text}</div>
          <button className="btn btn-sm" style={{ background: 'var(--danger)', color: '#fff', marginTop: 8 }} onClick={onTakeover}>
            <Hand size={13} style={{ marginRight: 4 }} /> Takeover
          </button>
        </div>
      </div>
    );
  }

  // Workflow status update
  if (msg.type === 'workflow') {
    return (
      <div className="agent-msg">
        <div className="agent-msg-workflow">
          <Zap size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span>{msg.text}</span>
        </div>
      </div>
    );
  }

  // Log message (subtle, monospace)
  if (msg.type === 'log') {
    return (
      <div className="agent-msg">
        <div className="agent-msg-log">
          <Bot size={12} style={{ flexShrink: 0, opacity: 0.5 }} />
          <span>{msg.text}</span>
        </div>
      </div>
    );
  }

  // Standard user/agent bubble
  return (
    <div className={`agent-msg ${isUser ? 'user' : ''}`}>
      <div className={`agent-msg-bubble ${isUser ? 'user' : 'agent'}`}>
        {msg.text}
      </div>
    </div>
  );
}
