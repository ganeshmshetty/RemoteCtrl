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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely extract a human-readable message + stack from any thrown value. */
function extractError(err: unknown): { ui: string; terminal: string } {
  if (err instanceof Error) {
    return { ui: err.message, terminal: err.stack ?? err.message };
  }
  try {
    const s = JSON.stringify(err);
    const t = s !== '{}' ? s : String(err);
    return { ui: t, terminal: t };
  } catch {
    return { ui: String(err), terminal: String(err) };
  }
}

/** Emit a log both to the terminal and to the renderer via callback. */
function emit(
  onLog: WorkflowLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[Workflow]',
) {
  const line = `${prefix} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  onLog({ level, message });
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
    const msg = `Another workflow (${activeRunId}) is already running.`;
    emit(onLog, 'warn', msg);
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();
  if (!page || !cdpUrl) {
    const msg = 'Host browser is not active. Launch a browser first.';
    emit(onLog, 'error', msg);
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    const msg = `No API key for provider "${provider}". Configure it in Settings.`;
    emit(onLog, 'error', msg);
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const modelName =
    provider === 'anthropic'
      ? 'anthropic/claude-sonnet-4-6'
      : provider === 'gemini'
      ? 'google/gemini-3.1-flash-lite-preview'
      : 'openai/gpt-4o';

  activeRunId = workflowRunId;
  cancelRequested = false;

  onRunStatus({ workflowRunId, state: 'running', currentStepIndex: 0 });
  emit(onLog, 'info', `Workflow "${name}" started — ${steps.length} step(s), model="${modelName}"`);

  let stagehand: Stagehand | null = null;

  try {
    emit(onLog, 'info', `Connecting to local browser via CDP: ${cdpUrl}`);

    stagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: { modelName, apiKey },
      logger: (line: any) => {
        const level = (line.level || 'info') as AgentLogPayload['level'];
        const msg: string = line.message ?? (typeof line === 'object' ? JSON.stringify(line) : String(line));
        emit(onLog, level, msg, '[Stagehand]');
      },
      verbose: 2,
    });

    emit(onLog, 'info', 'Initialising Stagehand...');
    await stagehand.init();
    emit(onLog, 'info', 'Stagehand ready.');

    // Navigate to startUrl if provided
    if (startUrl) {
      emit(onLog, 'info', `Navigating to ${startUrl}`);
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch((e: Error) => {
        emit(onLog, 'warn', `Navigation warning: ${e.message}`);
      });
    }

    // Execute steps sequentially
    for (let i = 0; i < steps.length; i++) {
      if (cancelRequested) {
        emit(onLog, 'info', `Workflow cancelled before step ${i + 1}`);
        onRunStatus({ workflowRunId, state: 'cancelled' });
        return;
      }

      const step = steps[i];
      emit(onLog, 'info', `━━ Step ${i + 1}/${steps.length}: action="${step.action}" instruction="${step.instruction}"`);
      onRunStatus({ workflowRunId, state: 'running', currentStepId: step.id, currentStepIndex: i });
      onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'running' });

      try {
        const result = await executeStep(stagehand!, page, step.action, step.instruction);

        if (cancelRequested) {
          onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'skipped' });
          onRunStatus({ workflowRunId, state: 'cancelled' });
          return;
        }

        emit(onLog, 'info', `✓ Step ${i + 1} completed. Result: ${JSON.stringify(result)}`);
        onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'completed', result });
      } catch (stepErr) {
        const { ui, terminal } = extractError(stepErr);
        emit(onLog, 'error', `✗ Step ${i + 1} failed:\n${terminal}`);
        onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'failed', error: ui });
        onRunStatus({ workflowRunId, state: 'failed', error: `Step ${i + 1}: ${ui}` });
        return; // Stop on first failure
      }
    }

    emit(onLog, 'info', `Workflow "${name}" completed successfully ✓`);
    onRunStatus({ workflowRunId, state: 'completed' });
  } catch (err) {
    const { ui, terminal } = extractError(err);
    if (cancelRequested) {
      emit(onLog, 'info', 'Workflow cancelled.');
      onRunStatus({ workflowRunId, state: 'cancelled' });
    } else {
      emit(onLog, 'error', `Workflow failed:\n${terminal}`);
      onRunStatus({ workflowRunId, state: 'failed', error: ui });
    }
  } finally {
    activeRunId = null;
    cancelRequested = false;
    stagehand = null;
  }
}

// ─── Navigation intent detection ────────────────────────────────────────────

const SITE_MAP: Record<string, string> = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  github: 'https://github.com',
  twitter: 'https://twitter.com',
  x: 'https://x.com',
  facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com',
  linkedin: 'https://www.linkedin.com',
  reddit: 'https://www.reddit.com',
  amazon: 'https://www.amazon.com',
  netflix: 'https://www.netflix.com',
  wikipedia: 'https://www.wikipedia.org',
  chatgpt: 'https://chatgpt.com',
  notion: 'https://www.notion.so',
  figma: 'https://www.figma.com',
  stackoverflow: 'https://stackoverflow.com',
  maps: 'https://maps.google.com',
};

function detectNavigationUrl(instruction: string): string | null {
  const nav = instruction
    .trim()
    .match(/^(?:open|go to|navigate to|visit|browse to|load|take me to)\s+(.+)$/i);
  if (!nav) return null;
  const target = nav[1].trim().toLowerCase().replace(/[./:]+$/, '');
  if (SITE_MAP[target]) return SITE_MAP[target];
  const raw = nav[1].trim();
  if (/^https?:\/\//.test(raw)) return raw;
  if (/^[\w-]+\.[\w.-]+/.test(raw)) return `https://${raw}`;
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
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
    timeoutId = setTimeout(
      () => reject(new Error(`Step timed out after ${STEP_TIMEOUT_MS / 1000}s`)),
      STEP_TIMEOUT_MS,
    );
  });

  const work = (async () => {
    if (action === 'act') {
      // Handle navigation intents directly — sh.act() can only interact with DOM elements
      const navUrl = detectNavigationUrl(instruction);
      if (navUrl) {
        console.log(`[Workflow] Navigation intent detected → ${navUrl}`);
        await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        return { success: true, navigatedTo: navUrl };
      }
      return await sh.act(instruction, { page });
    }
    if (action === 'observe') return await sh.observe(instruction, { page });
    if (action === 'extract') return await sh.extract(instruction, { page });
    throw new Error(`Unknown step action: "${action}"`);
  })();

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
