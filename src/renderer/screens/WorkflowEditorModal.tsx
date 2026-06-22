import { useState, useEffect } from 'react';
import { Save, Plus, GripVertical, Play } from 'lucide-react';
import { useUIStore } from '../stores/useUIStore';
import { useWorkflowStore } from '../stores/useWorkflowStore';
import type { WorkflowStep } from '../../shared/types';

export function WorkflowEditorModal() {
  const { isWorkflowEditorOpen, closeWorkflowEditor, editingWorkflowId } = useUIStore();
  const { workflows, saveWorkflow } = useWorkflowStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isWorkflowEditorOpen) {
      if (editingWorkflowId) {
        const wf = workflows.find(w => w.id === editingWorkflowId);
        if (wf) {
          setName(wf.name);
          setDescription(wf.description || '');
          setStartUrl(wf.startUrl || '');
          setSteps(wf.steps || []);
        }
      } else {
        setName('');
        setDescription('');
        setStartUrl('');
        setSteps([{ id: crypto.randomUUID(), instruction: '', action: 'act' }]);
      }
    }
  }, [isWorkflowEditorOpen, editingWorkflowId, workflows]);

  if (!isWorkflowEditorOpen) return null;

  function updateStep(index: number, updates: Partial<WorkflowStep>) {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    setSteps(newSteps);
  }

  function addStep() {
    setSteps([...steps, { id: crypto.randomUUID(), instruction: '', action: 'act' }]);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  async function handleSave() {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const newWf = {
        name,
        description,
        startUrl,
        steps: steps.filter(s => s.instruction.trim()),
      };
      await saveWorkflow({ id: editingWorkflowId || crypto.randomUUID(), ...newWf, createdAt: Date.now(), updatedAt: Date.now() } as any);
      closeWorkflowEditor();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="wf-editor-overlay">
      <div className="wf-editor-modal">
        <div className="wf-editor-header">
          <h3>{editingWorkflowId ? 'Edit Workflow' : 'Create Workflow'}</h3>
          <button className="icon-btn" onClick={closeWorkflowEditor}>✕</button>
        </div>
        
        <div className="wf-editor-body">
          <div className="wf-editor-field">
            <label>Name</label>
            <input 
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="e.g., Daily Login"
              autoFocus
            />
          </div>

          <div className="wf-editor-fields-row">
            <div className="wf-editor-field">
              <label>Description (Optional)</label>
              <input 
                value={description} 
                onChange={e => setDescription(e.target.value)} 
                placeholder="What does this do?"
              />
            </div>
            <div className="wf-editor-field">
              <label>Start URL (Optional)</label>
              <input 
                value={startUrl} 
                onChange={e => setStartUrl(e.target.value)} 
                placeholder="https://..."
              />
            </div>
          </div>

          <h4 className="wf-editor-steps-title">Steps</h4>
          
          {steps.map((step, idx) => (
            <div key={idx} className="wf-editor-step">
              <div className="wf-editor-step-grip">
                <GripVertical size={16} />
              </div>
              <div className="wf-editor-step-body">
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <span className="wf-editor-step-label">Step {idx + 1}</span>
                  <button className="icon-btn" style={{width: 24, height: 24}} onClick={() => removeStep(idx)}>✕</button>
                </div>
                <input 
                  className="wf-editor-step-input"
                  value={step.instruction}
                  onChange={e => updateStep(idx, { instruction: e.target.value })}
                  placeholder="e.g., Click the login button"
                />
                <div className="wf-editor-step-actions">
                  <button className="wf-editor-step-test-btn">
                    <Play size={12} /> Test Step
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button className="wf-editor-add-step-btn" onClick={addStep}>
            <Plus size={16} /> Add Step
          </button>
        </div>

        <div className="wf-editor-footer">
          <button className="btn btn-ghost" onClick={closeWorkflowEditor}>Cancel</button>
          <button 
            className="btn btn-primary" 
            onClick={handleSave} 
            disabled={!name.trim() || isSaving}
          >
            <Save size={16} /> {isSaving ? 'Saving...' : 'Save Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}
