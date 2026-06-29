import { useEffect, useState } from 'react';
import { Play, Edit2, Trash2, Plus, Zap } from 'lucide-react';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import { useUIStore } from '../stores/useUIStore';
import { useAgentStore } from '../stores/useAgentStore';
import { useConnectionStore } from '../stores/useConnectionStore';

export function WorkflowsPanel() {
  const { workflows, isLoading, error, loadWorkflows, deleteWorkflow } = useWorkflowStore();
  const { openWorkflowEditor } = useUIStore();
  
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  async function handleDelete(id: string) {
    await deleteWorkflow(id);
    setConfirmingDelete(null);
  }

  return (
    <div className="workflows-panel">
      <div className="workflows-header">
        <h2 className="workflows-header-title">Workflows</h2>
        <button 
          className="btn btn-sm btn-ghost"
          onClick={() => openWorkflowEditor()}
        >
          <Plus size={14} /> New
        </button>
      </div>

      <div className="workflows-list">
        {isLoading && <div className="workflows-empty">Loading workflows...</div>}
        {error && <div className="workflows-empty" style={{color: 'var(--danger)'}}>{error}</div>}
        
        {!isLoading && !error && workflows.length === 0 && (
          <div className="workflows-empty">
            <div className="workflows-empty-icon">
              <Zap size={24} />
            </div>
            <p>No workflows created yet.</p>
            <p style={{fontSize: 12, marginTop: 8}}>Create one to automate repetitive tasks.</p>
          </div>
        )}

        {workflows.map(wf => (
          <WorkflowCard 
            key={wf.id}
            workflow={wf}
            confirmingDelete={confirmingDelete === wf.id}
            onEdit={() => openWorkflowEditor(wf.id)}
            onDelete={() => setConfirmingDelete(wf.id)}
            onConfirmDelete={() => handleDelete(wf.id)}
            onCancelDelete={() => setConfirmingDelete(null)}
          />
        ))}
      </div>
    </div>
  );
}

function WorkflowCard({ workflow, confirmingDelete, onEdit, onDelete, onConfirmDelete, onCancelDelete }: any) {
  const { controllerState, hostState, sendData } = useConnectionStore();
  const isConnected = 
    hostState === 'SESSION_ACTIVE' || hostState === 'AGENT_EXECUTING' || hostState === 'HUMAN_TAKEOVER' ||
    controllerState === 'SESSION_ACTIVE' || controllerState === 'CONTROLLING_REMOTELY';
  
  const { setRightPanelTab } = useUIStore();
  
  function handleRun() {
    if (!isConnected) return;
    const workflowRunId = crypto.randomUUID();
    useAgentStore.getState().clearWorkflow();
    
    const payload = {
      workflowRunId,
      workflowId: workflow.id,
      name: workflow.name,
      startUrl: workflow.startUrl,
      steps: workflow.steps,
    };

    if (controllerState !== 'IDLE' && sendData) {
      sendData({
        type: 'AGENT_WORKFLOW_BATCH',
        version: '1.0',
        timestamp: Date.now(),
        payload,
      }, true);
    } else if (hostState !== 'IDLE') {
      window.RemoteCtrlAPI?.browser.startWorkflow(payload);
    }
    
    setRightPanelTab('agent');
  }

  return (
    <div className="workflow-card">
      <div className="workflow-card-header">
        <h3 className="workflow-card-name">{workflow.name}</h3>
        <div className="workflow-card-actions">
          <button className="workflow-card-action-btn" onClick={onEdit} title="Edit">
            <Edit2 size={14} />
          </button>
          {confirmingDelete ? (
            <div style={{display: 'flex', gap: 4}}>
              <button className="workflow-card-action-btn danger" onClick={onConfirmDelete}>✓</button>
              <button className="workflow-card-action-btn" onClick={onCancelDelete}>✗</button>
            </div>
          ) : (
            <button className="workflow-card-action-btn" onClick={onDelete} title="Delete">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      
      {workflow.description && (
        <p style={{fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12}}>{workflow.description}</p>
      )}
      
      <div className="workflow-card-meta">
        {workflow.steps.length} step{workflow.steps.length === 1 ? '' : 's'}
      </div>

      <button 
        className="workflow-card-run-btn"
        onClick={handleRun}
        disabled={!isConnected}
      >
        <Play size={14} /> {isConnected ? 'Run Workflow' : 'Connect to Run'}
      </button>
    </div>
  );
}
