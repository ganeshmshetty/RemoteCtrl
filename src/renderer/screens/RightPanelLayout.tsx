import { useUIStore } from '../stores/useUIStore';
import { AgentPanel } from './AgentPanel';
import { WorkflowsPanel } from './WorkflowsPanel';
import { Bot, Zap } from 'lucide-react';

export function RightPanelLayout() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();

  return (
    <div className="right-panel">
      <div className="right-panel-tabs">
        <button 
          className={`right-panel-tab ${rightPanelTab === 'agent' ? 'active' : ''}`}
          onClick={() => setRightPanelTab('agent')}
        >
          <Bot size={16} /> Agent
        </button>
        <button 
          className={`right-panel-tab ${rightPanelTab === 'workflows' ? 'active' : ''}`}
          onClick={() => setRightPanelTab('workflows')}
        >
          <Zap size={16} /> Workflows
        </button>
      </div>
      <div className="right-panel-content">
        {rightPanelTab === 'agent' ? <AgentPanel /> : <WorkflowsPanel />}
      </div>
    </div>
  );
}
