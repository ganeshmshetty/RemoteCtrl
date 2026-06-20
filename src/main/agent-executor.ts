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


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely extract a human-readable message from any thrown value. */
function extractError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  try {
    const s = JSON.stringify(err);
    return s !== '{}' ? s : String(err);
  } catch {
    return String(err);
  }
}

/** Emit a log both to the terminal and to the renderer via the callback. */
function emit(
  onLog: AgentLogCb,
  level: AgentLogPayload['level'],
  message: string,
  prefix = '[Agent]',
) {
  const line = `${prefix} ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  onLog({ level, message });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isAgentRunning(): boolean {
  return activeCommandId !== null;
}

export async function runAgentCommand(
  commandId: string,
  action: 'act' | 'observe' | 'extract',
  instruction: string,
  apiKey: string,
  provider: 'openai' | 'anthropic' | 'gemini',
  onStatus: AgentStatusCb,
  onLog: AgentLogCb,
): Promise<void> {
  // Reject if a command is already running
  if (activeCommandId !== null) {
    const msg = `Another command (${activeCommandId}) is already running. Cancel it first.`;
    emit(onLog, 'warn', msg);
    onStatus({ commandId, state: 'failed', error: msg });
    return;
  }

  const page = getPage();
  const cdpUrl = getCdpUrl();
  if (!page || !cdpUrl) {
    const msg = 'Browser is not running. Launch a browser from the Host session first.';
    emit(onLog, 'error', msg);
    onStatus({ commandId, state: 'failed', error: msg });
    return;
  }

  activeCommandId = commandId;
  cancelRequested = false;

  const modelName =
    provider === 'anthropic'
      ? 'anthropic/claude-sonnet-4-6'
      : provider === 'gemini'
      ? 'google/gemini-3.1-flash-lite-preview'
      : 'openai/gpt-4o';

  emit(onLog, 'info', `Starting — action="${action}" model="${modelName}"`, '[Agent]');
  emit(onLog, 'info', `Instruction: ${instruction}`, '[Agent]');
  onStatus({ commandId, state: 'running' });

  let localStagehand: Stagehand | null = null;
  let timeoutId: NodeJS.Timeout | undefined;
  let cancelIntervalId: NodeJS.Timeout | undefined;

  try {
    emit(onLog, 'info', `Connecting to local browser via CDP: ${cdpUrl}`, '[Agent]');

    localStagehand = new Stagehand({
      env: 'LOCAL',
      localBrowserLaunchOptions: { cdpUrl },
      model: { modelName, apiKey },
      logger: (logLine: any) => {
        const level = (logLine.level || 'info') as AgentLogPayload['level'];
        const msg: string = logLine.message ?? (typeof logLine === 'object' ? JSON.stringify(logLine) : String(logLine));
        emit(onLog, level, msg, '[Stagehand]');
      },
      verbose: 2,
    });

    // localStagehand is the active instance for this command

    emit(onLog, 'info', 'Initialising Stagehand...', '[Agent]');
    await localStagehand.init();
    emit(onLog, 'info', 'Stagehand ready.', '[Agent]');

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Command timed out after ${COMMAND_TIMEOUT_MS / 1000}s`)),
        COMMAND_TIMEOUT_MS,
      );
    });

    const cancelPromise = new Promise<never>((_, reject) => {
      cancelIntervalId = setInterval(() => {
        if (cancelRequested) reject(new Error('Cancelled by user'));
      }, 200);
    });

    const result = await Promise.race([
      executeAction(localStagehand, page, action, instruction),
      timeoutPromise,
      cancelPromise,
    ]);

    if (cancelRequested) {
      emit(onLog, 'info', 'Command cancelled.', '[Agent]');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      emit(onLog, 'info', `Command completed. Result: ${JSON.stringify(result)}`, '[Agent]');
      onStatus({ commandId, state: 'completed', result });
    }
  } catch (err) {
    const msg = extractError(err);
    if (cancelRequested) {
      emit(onLog, 'info', 'Command cancelled.', '[Agent]');
      onStatus({ commandId, state: 'cancelled' });
    } else {
      emit(onLog, 'error', `Command failed:\n${msg}`, '[Agent]');
      // Surface a clean single-line message to the UI; full stack is in terminal
      const uiMsg = err instanceof Error ? err.message : msg;
      onStatus({ commandId, state: 'failed', error: uiMsg });
    }
  } finally {
    clearTimeout(timeoutId);
    clearInterval(cancelIntervalId);
    activeCommandId = null;
    cancelRequested = false;
    localStagehand = null;
  }
}

export function cancelAgentCommand(): void {
  if (activeCommandId) {
    cancelRequested = true;
  }
}

// ─── Navigation intent detection ────────────────────────────────────────────

/**
 * Known site shortcuts → canonical URLs.
 * Extend this list freely.
 */
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

/**
 * If the instruction is a navigation intent ("open X", "go to X", etc.),
 * returns the resolved URL. Returns null if it looks like a page action.
 */
function detectNavigationUrl(instruction: string): string | null {
  const nav = instruction
    .trim()
    .match(/^(?:open|go to|navigate to|visit|browse to|load|take me to)\s+(.+)$/i);
  if (!nav) return null;

  const target = nav[1].trim().toLowerCase().replace(/[./:]+$/, '');

  // Check site map first
  if (SITE_MAP[target]) return SITE_MAP[target];

  // Looks like a domain (contains a dot)
  const raw = nav[1].trim();
  if (/^https?:\/\//.test(raw)) return raw;
  if (/^[\w-]+\.[\w.-]+/.test(raw)) return `https://${raw}`;

  // Fallback: Google search
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function executeAction(sh: Stagehand, page: Page, action: string, instruction: string) {
  if (action === 'act') {
    // Handle navigation intents directly — sh.act() can only click DOM elements
    const navUrl = detectNavigationUrl(instruction);
    if (navUrl) {
      console.log(`[Agent] Navigation intent detected → ${navUrl}`);
      await page.goto(navUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      return { success: true, navigatedTo: navUrl };
    }
    return await sh.act(instruction, { page });
  }
  if (action === 'observe') return await sh.observe(instruction, { page });
  if (action === 'extract') return await sh.extract(instruction, { page });
  throw new Error(`Unknown action: "${action}"`);
}
