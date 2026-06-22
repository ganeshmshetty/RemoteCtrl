#!/bin/bash
sed -i '' "s/await saveWorkflow(editingWorkflowId || crypto.randomUUID(), newWf as any);/await saveWorkflow({ id: editingWorkflowId || crypto.randomUUID(), ...newWf, createdAt: Date.now(), updatedAt: Date.now() } as any);/" src/renderer/screens/WorkflowEditorModal.tsx
