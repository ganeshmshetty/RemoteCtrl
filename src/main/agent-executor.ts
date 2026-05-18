/**
 * Agent Executor — Phase 4
 *
 * Wraps Stagehand to execute AGENT_PROMPT commands from the Controller.
 * One command runs at a time. A running command can be cancelled (best-effort).
 * All status and log events are forwarded to the renderer via callbacks
 * so it can relay them over the WebRTC data channel.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { getPage, getCdpUrl } from './browser-manager.js';
import type { AgentStatusPayload, AgentLogPayload } from '../shared/types.js';
import type { Page } from 'playwright';

export type AgentStatusCb = (payload: AgentStatusPayload) => void;
export type AgentLogCb = (payload: AgentLogPayload) => void;

// ─── Default timeout per command (ms) ────────────────────────────────────────
const COMMAND_TIMEOUT_MS = 90_000;

// ─── Module-level state ───────────────────────────────────────────────────────
let activeCommandId: string | null = null;
let cancelRequested = false;
let stagehand: Stagehand | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

export function isAgentRunning(): boolean {
  return activeCommandId !== null;
}

export async function runAgentCommand(
  commandId: string,
  action: 'act' | 'observe' | 'extract',
  instruction: string,
  apiKey: string,
  provider: 'openai' | 'anthropic',
  onStatus: AgentStatusCb,
  onLog: AgentLogCb,
): Promise<void> {
  // Reject if a command is already running
  if (activeCommandId !== null) {
    onStatus({
      commandId,
      state: 'failed',
      error: `Another command (${activeCommandId}) is already running. Cancel it first.`,
    });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();
  if (!page || !cdpUrl) {
    onStatus({ commandId, state: 'failed', error: 'Browser is not running.' });
    return;
  }

  activeCommandId = commandId;
  cancelRequested = false;

  // Signal running
  onStatus({ commandId, state: 'running' });

  try {
    // Initialise (or reuse) a Stagehand instance bound to the active page
    stagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: {
        modelName: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o',
        apiKey,
      },
      logger: (logLine: any) => {
        onLog({ level: (logLine.level || 'info') as 'info'|'warn'|'error', message: logLine.message });
      },
      verbose: 1,
    });

    await stagehand.init();

    let timeoutId: NodeJS.Timeout;
    let cancelIntervalId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Command ${commandId} timed out after ${COMMAND_TIMEOUT_MS}ms`)), COMMAND_TIMEOUT_MS);
    });

    const cancelPromise = new Promise<never>((_, reject) => {
      cancelIntervalId = setInterval(() => {
        if (cancelRequested) {
          reject(new Error('Cancelled'));
        }
      }, 200);
    });

    // Race: command vs timeout vs cancel
    const result = await Promise.race([
      executeAction(stagehand, page, action, instruction),
      timeoutPromise,
      cancelPromise,
    ]);

    clearTimeout(timeoutId!);
    clearInterval(cancelIntervalId!);

    if (cancelRequested) {
      onStatus({ commandId, state: 'cancelled' });
    } else {
      onStatus({ commandId, state: 'completed', result });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cancelRequested) {
      onStatus({ commandId, state: 'cancelled' });
    } else {
      onStatus({ commandId, state: 'failed', error: msg });
    }
  } finally {
    activeCommandId = null;
    cancelRequested = false;
    stagehand = null;
  }
}

export function cancelAgentCommand(): void {
  if (activeCommandId) {
    cancelRequested = true;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function executeAction(sh: Stagehand, page: Page, action: string, instruction: string) {
  if (action === 'act') {
    return await sh.act(instruction, { page });
  }
  if (action === 'observe') {
    return await sh.observe(instruction, { page });
  }
  if (action === 'extract') {
    return await sh.extract(instruction, { page });
  }
  throw new Error(`Unknown action: ${action}`);
}

// (Removed leaking timeout/waitForCancel functions)
