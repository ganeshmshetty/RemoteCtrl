/**
 * Workflow Executor — Phase 5 with Phase 1 Robustness Improvements
 *
 * Features:
 * - Stall detection with automatic recovery suggestions
 * - Retry logic with exponential backoff per step
 * - Better error handling with actionable messages
 * - Execution logging for debugging
 *
 * Runs an AGENT_WORKFLOW_BATCH sequentially through Stagehand.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import type { Page } from 'playwright';
import { parseInstruction } from './instruction-parser.js';
import { getPreferredModel } from './storage.js';
import type {
  AgentWorkflowBatchPayload,
  WorkflowRunStatus,
  WorkflowStepStatus,
  AgentLogPayload,
} from '../shared/types.js';
import { getPage, getCdpUrl } from './browser-manager.js';
import { getPreferredProvider, getApiKey } from './storage.js';
import {
  StallDetector,
  createPageFingerprint,
} from './stall-detector.js';
import {
  AgentStalledError,
  CommandExecutionError,
  RetryExhaustedError,
  extractError,
} from './errors.js';
import { TaskEvaluator } from './task-evaluator.js';

// ─── Callback Types ─────────────────────────────────────────────────────────

export type WorkflowRunStatusCb = (s: WorkflowRunStatus) => void;
export type WorkflowStepStatusCb = (s: WorkflowStepStatus) => void;
export type WorkflowLogCb = (l: AgentLogPayload) => void;

// ─── Configuration ──────────────────────────────────────────────────────────

const STALL_CHECK_INTERVAL = 3;

interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

// ─── Module State ───────────────────────────────────────────────────────────

let activeRunId: string | null = null;
let cancelRequested = false;
let isPaused = false;

// ─── Public API ─────────────────────────────────────────────────────────────

export function isWorkflowRunning(): boolean {
  return activeRunId !== null;
}

export function cancelWorkflow(): void {
  if (activeRunId) cancelRequested = true;
}

export function setWorkflowPaused(paused: boolean): void {
  isPaused = paused;
}

async function waitForResume(onLog: WorkflowLogCb): Promise<void> {
  if (!isPaused) return;
  emitLog(onLog, 'info', 'Workflow paused for manual takeover. Waiting for resume...', '[Workflow]');
  while (isPaused && !cancelRequested) {
    await sleep(500);
  }
  if (!cancelRequested) {
    emitLog(onLog, 'info', 'Workflow resumed. Capturing fresh page state...', '[Workflow]');
  }
}

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function runWorkflow(
  payload: AgentWorkflowBatchPayload,
  onRunStatus: WorkflowRunStatusCb,
  onStepStatus: WorkflowStepStatusCb,
  onLog: WorkflowLogCb,
): Promise<void> {
  const { workflowRunId, name, startUrl, steps } = payload;

  if (activeRunId) {
    const msg = `Another workflow (${activeRunId}) is already running.`;
    emitLog(onLog, 'warn', msg, '[Workflow]');
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();

  if (!page || !cdpUrl) {
    const msg = 'Host browser is not active. Launch a browser first.';
    emitLog(onLog, 'error', msg, '[Workflow]');
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const provider = getPreferredProvider();
  const apiKey = getApiKey(provider);

  if (!apiKey) {
    const msg = `No API key for provider "${provider}". Configure it in Settings.`;
    emitLog(onLog, 'error', msg, '[Workflow]');
    onRunStatus({ workflowRunId, state: 'failed', error: msg });
    return;
  }

  const modelName = getModelName(provider);

  activeRunId = workflowRunId;
  cancelRequested = false;

  onRunStatus({ workflowRunId, state: 'running', currentStepIndex: 0 });
  emitLog(onLog, 'info', `Workflow "${name}" started — ${steps.length} step(s), model="${modelName}"`, '[Workflow]');

  let stagehand: Stagehand | null = null;

  try {
    emitLog(onLog, 'info', `Connecting to local browser via CDP: ${cdpUrl}`, '[Workflow]');

    stagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: { modelName, apiKey },
      logger: (line: any) => {
        const level = (line.level || 'info') as AgentLogPayload['level'];
        const msg: string = line.message ?? (typeof line === 'object' ? JSON.stringify(line) : String(line));
        emitLog(onLog, level, msg, '[Stagehand]');
      },
      verbose: 2,
    });

    emitLog(onLog, 'info', 'Initialising Stagehand...', '[Workflow]');
    await stagehand.init();
    emitLog(onLog, 'info', 'Stagehand ready.', '[Workflow]');

    // Navigate to startUrl if provided
    if (startUrl) {
      emitLog(onLog, 'info', `Navigating to ${startUrl}`, '[Workflow]');
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch((e: Error) => {
        emitLog(onLog, 'warn', `Navigation warning: ${e.message}`, '[Workflow]');
      });
    }

    // Execute steps sequentially
    for (let i = 0; i < steps.length; i++) {
      if (isPaused) {
        await waitForResume(onLog);
      }

      if (cancelRequested) {
        emitLog(onLog, 'info', `Workflow cancelled before step ${i + 1}`, '[Workflow]');
        onStepStatus({ workflowRunId, stepId: steps[i].id, index: i, state: 'skipped' });
        onRunStatus({ workflowRunId, state: 'cancelled' });
        return;
      }

      const step = steps[i];
      emitLog(onLog, 'info', `━━ Step ${i + 1}/${steps.length}: action="${step.action}" instruction="${step.instruction}"`, '[Workflow]');
      onRunStatus({ workflowRunId, state: 'running', currentStepId: step.id, currentStepIndex: i });
      onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'running' });

      try {
        const result = await executeStepWithRetry(stagehand, page, step.action, step.instruction, onLog);

        if (cancelRequested) {
          onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'skipped' });
          onRunStatus({ workflowRunId, state: 'cancelled' });
          return;
        }

        emitLog(onLog, 'info', `✓ Step ${i + 1} completed. Result: ${JSON.stringify(result)}`, '[Workflow]');
        onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'completed', result });
      } catch (stepErr) {
        const errorInfo = extractError(stepErr);
        emitLog(onLog, 'error', `✗ Step ${i + 1} failed:\n${errorInfo.message}`, '[Workflow]');
        onStepStatus({ workflowRunId, stepId: step.id, index: i, state: 'failed', error: errorInfo.message });

        // Add actionable suggestion
        let suggestion = '';
        if (errorInfo.code === 'TIMEOUT') {
          suggestion = ' Try breaking the task into smaller steps.';
        } else if (errorInfo.code === 'STALL') {
          suggestion = ' The agent got stuck. Try rephrasing the instruction.';
        }

        const fullMessage = errorInfo.message + (suggestion ? ' ' + suggestion : '');
        onRunStatus({ workflowRunId, state: 'failed', error: fullMessage });
        return; // Stop on first failure
      }
    }

    emitLog(onLog, 'info', `Workflow "${name}" completed successfully ✓`, '[Workflow]');
    onRunStatus({ workflowRunId, state: 'completed' });
  } catch (err) {
    const errorInfo = extractError(err);
    if (cancelRequested) {
      emitLog(onLog, 'info', 'Workflow cancelled.', '[Workflow]');
      onRunStatus({ workflowRunId, state: 'cancelled' });
    } else {
      emitLog(onLog, 'error', `Workflow failed:\n${errorInfo.message}`, '[Workflow]');
      onRunStatus({ workflowRunId, state: 'failed', error: errorInfo.message });
    }
  } finally {
    activeRunId = null;
    cancelRequested = false;
    stagehand = null;
  }
}

// ─── Step Execution with Retry ──────────────────────────────────────────────

async function executeStepWithRetry(
  stagehand: Stagehand,
  page: Page,
  action: string,
  instruction: string,
  onLog: WorkflowLogCb,
): Promise<any> {
  const config = DEFAULT_RETRY_CONFIG;
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt < config.maxAttempts) {
    attempt++;

    try {
      emitLog(onLog, 'info', `Attempt ${attempt}/${config.maxAttempts}`, '[Workflow]');
      const result = await executeStepWithStallDetection(stagehand, page, action, instruction, onLog);

      if (attempt > 1) {
        emitLog(onLog, 'info', `Succeeded on attempt ${attempt}`, '[Workflow]');
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorInfo = extractError(lastError);

      emitLog(onLog, 'warn', `Attempt ${attempt} failed: ${errorInfo.message}`, '[Workflow]');

      // Don't retry if not retryable or last attempt
      if (attempt === config.maxAttempts || !errorInfo.retryable) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelayMs,
      );

      emitLog(onLog, 'info', `Retrying in ${delay}ms...`, '[Workflow]');
      await sleep(delay);
    }
  }

  // All retries exhausted
  throw new RetryExhaustedError(attempt, lastError!);
}

// ─── Step Execution with Stall Detection ────────────────────────────────────

async function executeStepWithStallDetection(
  stagehand: Stagehand,
  page: Page,
  action: string,
  instruction: string,
  onLog: WorkflowLogCb,
): Promise<any> {
  const stallDetector = new StallDetector();
  let step = 0;
  let lastStallCheck = 0;

  if (isPaused) {
    await waitForResume(onLog);
  }

  // Get initial fingerprint
  const initialFingerprint = await createPageFingerprint(page);
  stallDetector.recordFingerprint(initialFingerprint);

  const result = await (async () => {
    if (action === 'act') {
      // Parse instruction: split navigation from post-nav action
      // Inspired by browser-use (terminates_sequence) + nanobrowser (Planner decomposition)
      const parsed = await parseInstruction(instruction, page.url());

      if (parsed.navigationUrl) {
        emitLog(onLog, 'info', `Navigation intent detected → ${parsed.navigationUrl}`, '[Workflow]');
        await page.goto(parsed.navigationUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        // Wait for page to settle before acting
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { });

        if (parsed.navigationOnly || !parsed.remainingAction) {
          return { success: true, navigatedTo: parsed.navigationUrl };
        }

        emitLog(onLog, 'info', `Executing post-navigation action: "${parsed.remainingAction}"`, '[Workflow]');
        return await executeMultiStepAction(stagehand, page, parsed.remainingAction, onLog);
      }

      const res = await stagehand.act(instruction, { page });
      if (res && res.success === false) {
        throw new CommandExecutionError('act', res.message || 'Action failed to execute');
      }
      return res;
    }

    if (action === 'observe') {
      return await stagehand.observe(instruction, { page });
    }

    if (action === 'extract') {
      emitLog(onLog, 'info', `Extracting data...`, '[Workflow]');
      const res = await stagehand.extract(instruction, { page });
      
      // Level 2: Advanced AI Verification
      emitLog(onLog, 'info', `Verifying extraction quality...`, '[Workflow]');
      const evaluator = new TaskEvaluator();
      try {
        const evalResult = await evaluator.evaluate(
          instruction,
          res,
          { stepsExecuted: 1, errors: [], collectedData: res as any }
        );
        
        if (!evalResult.success) {
          throw new CommandExecutionError('extract', `Extraction incomplete: ${evalResult.missingElements.join(', ')}. Suggestions: ${evalResult.suggestions.join(', ')}`);
        }
        emitLog(onLog, 'info', `Extraction verified (Confidence: ${Math.round(evalResult.confidence * 100)}%)`, '[Workflow]');
      } catch (e: any) {
        if (e instanceof CommandExecutionError) throw e;
        emitLog(onLog, 'warn', `AI verification failed: ${e.message}`, '[Workflow]');
      }
      
      return res;
    }

    throw new Error(`Unknown action: "${action}"`);
  })();

  // Record action for stall detection
  stallDetector.recordAction(action, instruction);
  step++;

  // Periodic stall check
  if (step % STALL_CHECK_INTERVAL === 0 || lastStallCheck === 0) {
    const currentFingerprint = await createPageFingerprint(page);
    stallDetector.recordFingerprint(currentFingerprint);
    lastStallCheck = step;

    const stallCheck = stallDetector.isStuck();

    if (stallCheck.stuck) {
      emitLog(onLog, 'warn', `Stall detected: ${stallCheck.reason}`, '[Workflow]');

      const nudge = stallDetector.getLoopNudgeMessage();
      if (nudge) {
        emitLog(onLog, 'info', `Recovery suggestion:\n${nudge}`, '[Workflow]');
      }

      throw new AgentStalledError(stallCheck.reason, true);
    }
  }

  return result;
}

// ─── Multi-step post-navigation action runner ────────────────────────────────
//
// After navigating, the remaining goal may require several sequential DOM
// actions. We run a small ReAct-style loop:
//   act → check if done → repeat (up to POST_NAV_MAX_STEPS)

const POST_NAV_MAX_STEPS = 8;

async function executeMultiStepAction(
  stagehand: Stagehand,
  page: Page,
  goal: string,
  onLog: WorkflowLogCb,
): Promise<any> {
  let lastResult: any = null;
  const completedSteps: string[] = [];
  let successfulSteps = 0;

  for (let step = 0; step < POST_NAV_MAX_STEPS; step++) {
    if (isPaused) {
      await waitForResume(onLog);
      if (cancelRequested) break;
    }

    const contextSummary = completedSteps.length
      ? `Steps already done:\n${completedSteps.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}\n\n`
      : '';

    const singleStepPrompt =
      `${contextSummary}` +
      `Overall goal: "${goal}"\n\n` +
      `Perform only the NEXT single action needed to progress towards the goal. ` +
      `CRITICAL: If the goal is already complete, DO NOT take any action. Instead, output the exact phrase "GOAL_ACHIEVED" as your action description.`;

    emitLog(onLog, 'info', `Post-nav step ${step + 1}: ${goal}`, '[Workflow]');

    try {
      const result = await stagehand.act(singleStepPrompt, { page });

    if (result.actionDescription?.includes('GOAL_ACHIEVED')) {
      return { success: true, message: 'Goal achieved successfully' };
    }
    
    if (result && result.success === false) {
      throw new CommandExecutionError('act', result.message || 'Action failed to execute');
    }    
      lastResult = result;
      successfulSteps++;

      const actionDesc: string =
        lastResult?.actionDescription ??
        lastResult?.message ??
        JSON.stringify(lastResult);

      completedSteps.push(actionDesc);
      emitLog(onLog, 'info', `Step ${step + 1} done: ${actionDesc}`, '[Workflow]');

      if (actionDesc.includes('GOAL_ACHIEVED')) {
        emitLog(onLog, 'info', `Goal achieved after ${step + 1} step(s).`, '[Workflow]');
        break;
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Unknown execution error';
      emitLog(onLog, 'warn', `Step ${step + 1} failed: ${errorMsg}. Retrying...`, '[Workflow]');
      completedSteps.push(`FAILED PREVIOUS ATTEMPT: ${errorMsg}. Do not repeat this exact action. Try an alternative approach.`);
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  if (successfulSteps === 0 && lastResult === null) {
    throw new Error(`Multi-step action failed: all ${POST_NAV_MAX_STEPS} attempts failed`);
  }

  return lastResult ?? { success: true, message: 'Multi-step action completed.' };
}

// ─── Navigation Detection ────────────────────────────────────────────────────
// Moved to src/main/instruction-parser.ts — see parseInstruction()


// ─── Helpers ────────────────────────────────────────────────────────────────

function getModelName(provider: string): string {
  const preferred = getPreferredModel();
  if (preferred) return preferred;

  switch (provider) {
    case 'openai':
      return 'gpt-4o';
    case 'anthropic':
      return 'claude-3-5-sonnet-latest';
    case 'gemini':
      return 'gemini-1.5-pro';
    case 'groq':
      return 'llama-3.3-70b-versatile';
    case 'deepseek':
      return 'deepseek-chat';
    case 'nebius':
      return 'meta-llama/Llama-3.3-70B-Instruct';
    case 'openrouter':
      return 'anthropic/claude-3.5-sonnet';
    default:
      return 'gpt-4o';
  }
}

function emitLog(
  onLog: WorkflowLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[Workflow]',
): void {
  const line = `${prefix} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  onLog({ level, message });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
