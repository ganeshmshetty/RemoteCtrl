#!/bin/bash
# Remove unused imports and variables

sed -i '' "s/const { controllerState } = useConnectionStore();/const { controllerState } = useConnectionStore();/g" src/renderer/screens/ControllerSession.tsx
# In TopNav.tsx: Remove unused 'Link' import and 'setRole'
sed -i '' "s/import { Link, Settings, Wifi } from 'lucide-react';/import { Settings, Wifi } from 'lucide-react';/" src/renderer/screens/TopNav.tsx
sed -i '' "s/const { hostState, controllerState, pin, setRole, reset } = useConnectionStore();/const { hostState, controllerState, pin, reset } = useConnectionStore();/" src/renderer/screens/TopNav.tsx

# In WorkflowEditorModal.tsx: Remove unused 'X', fix 'id' in new step, and fix addStep
sed -i '' "s/import { Save, Plus, X, GripVertical, Play }/import { Save, Plus, GripVertical, Play }/" src/renderer/screens/WorkflowEditorModal.tsx
sed -i '' "s/setSteps(\[{ instruction: '', action: 'act' }\]);/setSteps(\[{ id: crypto.randomUUID(), instruction: '', action: 'act' }\]);/" src/renderer/screens/WorkflowEditorModal.tsx
sed -i '' "s/setSteps(\[...steps, { instruction: '', action: 'act' }\]);/setSteps(\[...steps, { id: crypto.randomUUID(), instruction: '', action: 'act' }\]);/" src/renderer/screens/WorkflowEditorModal.tsx
sed -i '' "s/await saveWorkflow(editingWorkflowId || undefined, newWf);/await saveWorkflow(editingWorkflowId || crypto.randomUUID(), newWf as any);/" src/renderer/screens/WorkflowEditorModal.tsx

# In WorkflowsPanel.tsx: Remove unused imports and variables
sed -i '' "s/import type { LocalWorkflow } from '..\/..\/shared\/types';//" src/renderer/screens/WorkflowsPanel.tsx
sed -i '' "s/const { openWorkflowEditor, setRightPanelTab } = useUIStore();/const { openWorkflowEditor } = useUIStore();/" src/renderer/screens/WorkflowsPanel.tsx
sed -i '' "s/const workflowRunId = crypto.randomUUID();/ /" src/renderer/screens/WorkflowsPanel.tsx
sed -i '' "s/const rtc = window.RemoteCtrlAPI?.controller;/ /" src/renderer/screens/WorkflowsPanel.tsx
sed -i '' "s/function WorkflowCard({ workflow, confirmingDelete, onRun, onEdit, onDelete, onConfirmDelete, onCancelDelete }: any)/function WorkflowCard({ workflow, confirmingDelete, onEdit, onDelete, onConfirmDelete, onCancelDelete }: any)/" src/renderer/screens/WorkflowsPanel.tsx

