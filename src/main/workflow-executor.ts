/**
 * Workflow Executor — Phase 5
 *
 * Runs an AGENT_WORKFLOW_BATCH sequentially through Stagehand.
 * One workflow run at a time.  A running workflow can be cancelled.
 * Status (per-workflow and per-step) + logs are forwarded via callbacks
 * so the Host renderer can relay them to the Controller.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import type { Page } from 'playwright';
import type {
  AgentWorkflowBatchPayload,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentLogPayload,
} from '../shared/types.js';
import { getPage, getCdpUrl } from './browser-manager.js';
import { getPreferredProvider, getApiKey } from './storage.js';

// ─── Callback types ───────────────────────────────────────────────────────────

export type WorkflowRunStatusCb = (s: WorkflowRunStatus) => void;
export type WorkflowStepStatusCb = (s: WorkflowStepStatus) => void;
export type WorkflowLogCb = (l: AgentLogPayload) => void;

// ─── Module-level state ───────────────────────────────────────────────────────

let activeRunId: string | null = null;
let cancelRequested = false;

export function isWorkflowRunning(): boolean {
  return activeRunId !== null;
}

export function cancelWorkflow(): void {
  if (activeRunId) cancelRequested = true;
}

// ─── Main executor ────────────────────────────────────────────────────────────

export async function runWorkflow(
  payload: AgentWorkflowBatchPayload,
  onRunStatus: WorkflowRunStatusCb,
  onStepStatus: WorkflowStepStatusCb,
  onLog: WorkflowLogCb,
): Promise<void> {
  const { workflowRunId, name, startUrl, steps } = payload;

  if (activeRunId) {
    onRunStatus({
      workflowRunId,
      state: 'failed',
      error: `Another workflow (${activeRunId}) is already running.`,
    });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();
  if (!page || !cdpUrl) {
    onRunStatus({ workflowRunId, state: 'failed', error: 'Host browser is not active.' });
    return;
  }

  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    onRunStatus({
      workflowRunId,
      state: 'failed',
      error: `No API key for provider "${provider}". Configure it in Settings.`,
    });
    return;
  }

  activeRunId = workflowRunId;
  cancelRequested = false;

  onRunStatus({ workflowRunId, state: 'running', currentStepIndex: 0 });
  onLog({ level: 'info', message: `Workflow "${name}" started (${steps.length} steps)` });

  let stagehand: Stagehand | null = null;

  try {
    stagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: {
        modelName: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o',
        apiKey,
      },
      logger: (line: any) => {
        onLog({
          level: (line.level || 'info') as AgentLogPayload['level'],
          message: line.message ?? String(line),
        });
      },
      verbose: 1,
    });

    await stagehand.init();

    // Navigate to startUrl if provided
    if (startUrl) {
      onLog({ level: 'info', message: `Navigating to ${startUrl}` });
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch((e) => {
        onLog({ level: 'warn', message: `Navigation warning: ${e.message}` });
      });
    }

    // Execute steps sequentially
    for (let i = 0; i < steps.length; i++) {
      if (cancelRequested) {
        onLog({ level: 'info', message: `Workflow cancelled before step ${i + 1}` });
        onRunStatus({ workflowRunId, state: 'cancelled' });
        return;
      }

      const step = steps[i];
      onRunStatus({
        workflowRunId,
        state: 'running',
        currentStepId: step.id,
        currentStepIndex: i,
      });
      onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'running' });
      onLog({ level: 'info', message: `Step ${i + 1}/${steps.length}: ${step.action} — "${step.instruction}"` });

      try {
        const result = await executeStep(stagehand!, page, step.action, step.instruction);

        if (cancelRequested) {
          onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'skipped' });
          onRunStatus({ workflowRunId, state: 'cancelled' });
          return;
        }

        onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'completed', result });
        onLog({ level: 'info', message: `Step ${i + 1} completed` });
      } catch (stepErr) {
        const msg = stepErr instanceof Error ? stepErr.message : String(stepErr);
        onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'failed', error: msg });
        onLog({ level: 'error', message: `Step ${i + 1} failed: ${msg}` });
        onRunStatus({ workflowRunId, state: 'failed', error: `Step ${i + 1} failed: ${msg}` });
        return; // Stop on first failure (no continueOnError in MVP)
      }
    }

    onRunStatus({ workflowRunId, state: 'completed' });
    onLog({ level: 'info', message: `Workflow "${name}" completed successfully` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cancelRequested) {
      onRunStatus({ workflowRunId, state: 'cancelled' });
    } else {
      onRunStatus({ workflowRunId, state: 'failed', error: msg });
      onLog({ level: 'error', message: `Workflow error: ${msg}` });
    }
  } finally {
    activeRunId = null;
    cancelRequested = false;
    stagehand = null;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function executeStep(
  sh: Stagehand,
  page: Page,
  action: string,
  instruction: string,
): Promise<unknown> {
  const STEP_TIMEOUT_MS = 90_000;
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Step timed out after ${STEP_TIMEOUT_MS / 1000}s`)), STEP_TIMEOUT_MS);
  });

  const work = (async () => {
    if (action === 'act') return await sh.act(instruction, { page });
    if (action === 'observe') return await sh.observe(instruction, { page });
    if (action === 'extract') return await sh.extract(instruction, { page });
    throw new Error(`Unknown step action: ${action}`);
  })();

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
